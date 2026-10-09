-- ════════════════════════════════════════════════════════════════════════
-- Event consolidation: add-on capacity through addon_available, and refunded
-- add-on rows move without moving stock.
--
-- 1. The destination add-on capacity check subtracted only cart holds WHERE
--    variant_id IS NULL and the parent's own quantity_sold. Variant holds and
--    variant sales on the destination add-on were not counted, so a move
--    could push the add-on past quantity_total. It now calls
--    public.addon_available (20261009100000), the same rule as cart_create_hold.
--    Moved purchases that carry a variant are still refused by the existing
--    event_consolidation_addon_variant_unsupported guard; no variant has ever
--    existed in production (ticket_addon_variants is empty, checked
--    2026-10-09), so there is no variant map to add.
--
-- 2. Since 20261009010000 a refunded add-on row has already returned its
--    quantity to quantity_sold. The move still counted it as incoming and
--    shifted its full quantity off the source, which either under-counts the
--    source or trips ticket_addons_qty_nonneg and aborts the whole move. A
--    refunded row now moves with quantity 0 in the ledger.
--
-- Body is 20261002200000 verbatim apart from those three expressions.
-- Signature and grants unchanged. No data is changed.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.execute_event_consolidation(
  p_source_event_id integer,
  p_destination_event_id integer,
  p_actor_auth_id text,
  p_operation_id uuid,
  p_expected_preflight_hash text,
  p_ticket_type_map jsonb,
  p_addon_map jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_source public.events%ROWTYPE;
  v_destination public.events%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_moved integer := 0;
  v_moved_addons integer := 0;
  v_moved_checkins integer := 0;
  v_moved_addon_qty bigint := 0;
  v_attendees integer;
  v_existing public.event_consolidation_operations%ROWTYPE;
BEGIN
  IF p_source_event_id = p_destination_event_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Source and destination must differ');
  END IF;

  SELECT * INTO v_existing FROM public.event_consolidation_operations
    WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.status = 'completed' THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true,
        'moved_count', v_existing.moved_count, 'after', v_existing.after_snapshot);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Operation id is already in progress');
  END IF;

  -- Deterministic lock order prevents source/destination inversion deadlocks.
  PERFORM 1 FROM public.events
    WHERE id IN (p_source_event_id, p_destination_event_id)
    ORDER BY id FOR UPDATE;

  SELECT * INTO v_source FROM public.events WHERE id = p_source_event_id;
  SELECT * INTO v_destination FROM public.events WHERE id = p_destination_event_id;
  IF v_source.id IS NULL OR v_destination.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Source or destination event not found');
  END IF;

  -- The actor must own, or be an accepted admin of, BOTH events. Checking only
  -- the source let any host mint comps on a throwaway event and push them into
  -- a stranger's event by integer id: the victim's quantity_sold was rewritten,
  -- their guest list gained attendees they never sold to, and the door admitted
  -- those QRs because ticket-scan resolves the event from the ticket row.
  -- Service-role callers still supply the human actor id so the immutable
  -- ledger is attributable.
  IF v_source.host_id IS DISTINCT FROM p_actor_auth_id AND NOT EXISTS (
    SELECT 1 FROM public.event_co_organizers
    WHERE event_id = p_source_event_id AND user_id = p_actor_auth_id
      AND accepted = true AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Actor cannot consolidate source event');
  END IF;

  IF v_destination.host_id IS DISTINCT FROM p_actor_auth_id AND NOT EXISTS (
    SELECT 1 FROM public.event_co_organizers
    WHERE event_id = p_destination_event_id AND user_id = p_actor_auth_id
      AND accepted = true AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Actor cannot consolidate into destination event');
  END IF;

  v_before := public.event_consolidation_snapshot(p_source_event_id, p_destination_event_id);
  IF v_before->>'fingerprint' IS DISTINCT FROM p_expected_preflight_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Preflight is stale; run it again');
  END IF;

  -- Pin the set being moved. Without this, a ticket issued into the source
  -- after the guards below would be picked up by the move but never checked
  -- against the tier map or the destination capacity.
  PERFORM 1 FROM public.tickets t
    WHERE t.event_id = p_source_event_id
      AND t.status IN ('active','scanned','transfer_pending')
    ORDER BY t.id FOR UPDATE;

  -- tickets.ticket_type_id is nullable on purpose, so free RSVP tickets can
  -- exist without a tier (20260334_tickets_nullable_ticket_type.sql). The
  -- original predicate was `NOT (map ? t.ticket_type_id::text)`, and
  -- `jsonb ? NULL` evaluates to NULL rather than true, so a NULL-tier row was
  -- never flagged. The move has no tier filter, so those tickets did move,
  -- with `map->>NULL` giving them a NULL destination tier, invisible to the
  -- per-tier quantity_sold recompute and to the capacity check below.
  -- A JSON object key cannot be NULL, so there is no way to map them. Refuse
  -- the whole operation rather than move untracked admissions.
  IF EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.event_id = p_source_event_id
      AND t.status IN ('active','scanned','transfer_pending')
      AND (t.ticket_type_id IS NULL
           OR NOT (p_ticket_type_map ? t.ticket_type_id::text))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Every active source ticket needs a destination tier mapping, including tier-less RSVP tickets');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(p_ticket_type_map) m
    LEFT JOIN public.ticket_types tt
      ON tt.id = m.value::uuid AND tt.event_id = p_destination_event_id
    WHERE tt.id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket type map contains a tier outside destination event');
  END IF;

  -- Capacity. The move did not reference quantity_total at all, so 200 source
  -- tickets could land in a 50-capacity tier: sold out to buyers, 250 valid
  -- QRs at the door, no way to unwind it.
  --
  -- This is the same arithmetic ticket_hold_create_atomic and cart_create_hold
  -- use: lock the tier row FOR UPDATE, then available = quantity_total -
  -- quantity_sold - live cart holds - live legacy holds. The lock is what makes
  -- it atomic. Every buyer of a destination tier serialises on that row, so no
  -- hold can be granted between this check and the move below. Tiers are
  -- locked in id order so two consolidations into overlapping tiers cannot
  -- deadlock. NULL quantity_total means unlimited and is skipped, not read as
  -- zero.
  PERFORM 1 FROM public.ticket_types tt
    WHERE tt.id IN (SELECT m.value::uuid FROM jsonb_each_text(p_ticket_type_map) m)
    ORDER BY tt.id FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (p_ticket_type_map->>t.ticket_type_id::text)::uuid AS dest_tier,
             count(*) AS incoming
      FROM public.tickets t
      WHERE t.event_id = p_source_event_id
        AND t.status IN ('active','scanned','transfer_pending')
      GROUP BY 1
    ) m
    JOIN public.ticket_types tt ON tt.id = m.dest_tier
    WHERE tt.quantity_total IS NOT NULL
      AND m.incoming > tt.quantity_total
        - COALESCE(tt.quantity_sold, 0)
        - COALESCE((SELECT sum(ch.qty) FROM public.cart_holds ch
                    WHERE ch.tier_id = tt.id AND ch.released = false
                      AND ch.expires_at > now()), 0)
        - COALESCE((SELECT sum(th.quantity) FROM public.ticket_holds th
                    WHERE th.ticket_type_id = tt.id AND th.status = 'active'
                      AND th.expires_at > now()), 0)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Destination tier capacity would be exceeded');
  END IF;

  -- Event cap. Tier capacity alone let a move push the destination past
  -- events.max_attendees: two tiers with room each could together exceed the
  -- event. The count uses recompute_event_total_attendees's rule (distinct
  -- user over active and scanned tickets plus going RSVPs), so it predicts
  -- the total_attendees the trigger will write after the move. Both event
  -- rows are already locked FOR UPDATE above. NULL max_attendees means no cap.
  IF v_destination.max_attendees IS NOT NULL THEN
    SELECT count(DISTINCT u) INTO v_attendees
    FROM (
      SELECT user_id::text AS u FROM public.tickets
        WHERE event_id IN (p_source_event_id, p_destination_event_id)
          AND status IN ('active', 'scanned')
      UNION
      SELECT user_id::text AS u FROM public.event_rsvps
        WHERE event_id = p_destination_event_id AND status = 'going'
    ) merged;
    IF v_attendees > v_destination.max_attendees THEN
      RETURN jsonb_build_object('ok', false,
        'error', format('Destination event is capped at %s attendees; consolidating would make it %s',
                        v_destination.max_attendees, v_attendees));
    END IF;
  END IF;

  -- Add-ons. A moved purchase used to keep addon_id pointing at the SOURCE
  -- event's catalog item, so the destination door showed an item it never
  -- sold and neither event's quantity_sold changed: the source stayed
  -- oversold-looking, the destination could sell the same stock again.
  -- The add-ons that move are exactly those on the source attached to a
  -- ticket that moves (the active set pinned above). Lock them, then every
  -- catalog row on either side, in id order, before reading any capacity.
  PERFORM 1 FROM public.order_addons oa
    WHERE oa.event_id = p_source_event_id
      AND oa.ticket_id IN (SELECT t.id FROM public.tickets t
                           WHERE t.event_id = p_source_event_id
                             AND t.status IN ('active','scanned','transfer_pending'))
    ORDER BY oa.id FOR UPDATE;

  -- No variant map exists, and a variant's stock lives on
  -- ticket_addon_variants, so a variant purchase cannot be remapped safely.
  -- Production has no variants today (checked 2026-10-03). Refuse.
  IF EXISTS (
    SELECT 1 FROM public.order_addons oa
    JOIN public.tickets t ON t.id = oa.ticket_id
    WHERE oa.event_id = p_source_event_id AND oa.variant_id IS NOT NULL
      AND t.event_id = p_source_event_id
      AND t.status IN ('active','scanned','transfer_pending')
  ) THEN
    RAISE EXCEPTION 'event_consolidation_addon_variant_unsupported: a moved add-on purchase has a variant; variants cannot be remapped'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_addons oa
    JOIN public.tickets t ON t.id = oa.ticket_id
    WHERE oa.event_id = p_source_event_id
      AND t.event_id = p_source_event_id
      AND t.status IN ('active','scanned','transfer_pending')
      AND NOT (COALESCE(p_addon_map, '{}'::jsonb) ? oa.addon_id::text)
  ) THEN
    RAISE EXCEPTION 'event_consolidation_addon_unmapped: every moved add-on purchase needs a destination add-on in p_addon_map'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(COALESCE(p_addon_map, '{}'::jsonb)) m
    LEFT JOIN public.ticket_addons a
      ON a.id = m.value::uuid AND a.event_id = p_destination_event_id
    WHERE a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'event_consolidation_addon_map_invalid: p_addon_map points at an add-on outside the destination event'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.ticket_addons a
    WHERE a.id IN (SELECT m.key::uuid FROM jsonb_each_text(COALESCE(p_addon_map, '{}'::jsonb)) m
                   UNION
                   SELECT m.value::uuid FROM jsonb_each_text(COALESCE(p_addon_map, '{}'::jsonb)) m)
    ORDER BY a.id FOR UPDATE;

  -- Destination room is public.addon_available, the rule cart_create_hold
  -- uses: it counts variant sales and every live cart hold on the add-on,
  -- variant holds included. Incoming is the moved quantity still inside
  -- quantity_sold. A refunded row gave its stock back
  -- (cart_apply_line_refund / refund_order_addons_for_cart, 20261009010000),
  -- so it counts 0 here and in the ledger; a redeemed row is still sold.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (p_addon_map->>oa.addon_id::text)::uuid AS dest_addon,
             sum(CASE WHEN oa.status = 'refunded' THEN 0 ELSE oa.quantity END) AS incoming
      FROM public.order_addons oa
      JOIN public.tickets t ON t.id = oa.ticket_id
      WHERE oa.event_id = p_source_event_id
        AND t.event_id = p_source_event_id
        AND t.status IN ('active','scanned','transfer_pending')
      GROUP BY 1
    ) m
    JOIN public.ticket_addons a ON a.id = m.dest_addon
    WHERE a.quantity_total IS NOT NULL
      AND m.incoming > public.addon_available(a.id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Destination add-on capacity would be exceeded');
  END IF;

  INSERT INTO public.event_consolidation_operations(
    operation_id, source_event_id, destination_event_id, actor_auth_id,
    preflight_hash, ticket_type_map, addon_map, before_snapshot
  ) VALUES (
    p_operation_id, p_source_event_id, p_destination_event_id, p_actor_auth_id,
    p_expected_preflight_hash, p_ticket_type_map, COALESCE(p_addon_map, '{}'::jsonb), v_before
  );

  INSERT INTO public.event_consolidation_ticket_ledger(
    operation_id, ticket_id, source_event_id, destination_event_id,
    source_ticket_type_id, destination_ticket_type_id
  )
  SELECT p_operation_id, t.id, p_source_event_id, p_destination_event_id,
         t.ticket_type_id, (p_ticket_type_map->>t.ticket_type_id::text)::uuid
  FROM public.tickets t
  WHERE t.event_id = p_source_event_id
    AND t.status IN ('active','scanned','transfer_pending');

  -- Move exactly the ledgered rows, so the ledger, the checks above and the
  -- move all describe the same set.
  UPDATE public.tickets t
  SET event_id = p_destination_event_id,
      ticket_type_id = l.destination_ticket_type_id
  FROM public.event_consolidation_ticket_ledger l
  WHERE l.operation_id = p_operation_id
    AND l.ticket_id = t.id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Add-ons and door audit rows follow their ticket. Left behind, a moved
  -- ticket's drink or merch QR fails redeem_addon at the new door as
  -- wrong_event, and the source keeps check-in history for admissions it no
  -- longer holds. Only rows already on the source move: a checkin recorded
  -- at some other event's door (result wrong_event) stays where it was
  -- scanned. Add-on scans can carry order_addon_id with no ticket_id, so
  -- those follow the add-on.
  -- Each moved purchase is re-pointed at its mapped destination catalog item.
  INSERT INTO public.event_consolidation_addon_ledger(
    operation_id, order_addon_id, source_addon_id, destination_addon_id, quantity
  )
  SELECT p_operation_id, oa.id, oa.addon_id,
         (p_addon_map->>oa.addon_id::text)::uuid,
         CASE WHEN oa.status = 'refunded' THEN 0 ELSE oa.quantity END
  FROM public.order_addons oa
  JOIN public.event_consolidation_ticket_ledger l
    ON l.operation_id = p_operation_id AND l.ticket_id = oa.ticket_id
  WHERE oa.event_id = p_source_event_id;

  UPDATE public.order_addons oa
  SET event_id = p_destination_event_id,
      addon_id = al.destination_addon_id
  FROM public.event_consolidation_addon_ledger al
  WHERE al.operation_id = p_operation_id
    AND al.order_addon_id = oa.id;
  GET DIAGNOSTICS v_moved_addons = ROW_COUNT;

  -- Shift sold stock by exactly what moved, so any drift these items already
  -- carry for reasons unrelated to the move is neither hidden nor rewritten
  -- (unlike ticket tiers, nothing establishes order_addons as the
  -- authoritative source for add-on quantity_sold). The source decrement hits the
  -- ticket_addons_qty_nonneg CHECK if the source was under-counted, which
  -- aborts the move rather than clamping to zero.
  UPDATE public.ticket_addons a
  SET quantity_sold = COALESCE(a.quantity_sold, 0) - s.qty
  FROM (SELECT source_addon_id AS id, sum(quantity) AS qty
        FROM public.event_consolidation_addon_ledger
        WHERE operation_id = p_operation_id GROUP BY 1) s
  WHERE a.id = s.id;

  UPDATE public.ticket_addons a
  SET quantity_sold = COALESCE(a.quantity_sold, 0) + d.qty
  FROM (SELECT destination_addon_id AS id, sum(quantity) AS qty
        FROM public.event_consolidation_addon_ledger
        WHERE operation_id = p_operation_id GROUP BY 1) d
  WHERE a.id = d.id;

  SELECT COALESCE(sum(quantity), 0) INTO v_moved_addon_qty
  FROM public.event_consolidation_addon_ledger WHERE operation_id = p_operation_id;

  UPDATE public.checkins c
  SET event_id = p_destination_event_id
  WHERE c.event_id = p_source_event_id
    AND (c.ticket_id IN (SELECT l.ticket_id FROM public.event_consolidation_ticket_ledger l
                          WHERE l.operation_id = p_operation_id)
         OR c.order_addon_id IN (SELECT oa.id FROM public.order_addons oa
                                  JOIN public.event_consolidation_ticket_ledger l
                                    ON l.ticket_id = oa.ticket_id
                                 WHERE l.operation_id = p_operation_id));
  GET DIAGNOSTICS v_moved_checkins = ROW_COUNT;

  -- Recompute sold inventory from authoritative active admission rows. Historical
  -- orders/payment/refund rows remain on their original event intentionally.
  UPDATE public.ticket_types tt
  SET quantity_sold = (
    SELECT count(*) FROM public.tickets t
    WHERE t.ticket_type_id = tt.id
      AND t.status IN ('active','scanned','transfer_pending')
  )
  WHERE tt.event_id IN (p_source_event_id, p_destination_event_id);

  -- events.total_attendees is maintained by trg_maintain_event_total_attendees,
  -- which this migration extends (below) to fire on event_id changes and
  -- recount both the old and the new event. Nothing to do here.

  v_after := public.event_consolidation_snapshot(p_source_event_id, p_destination_event_id);

  -- Reconcile. Every count must have moved by exactly what this function
  -- moved, and nothing else may have changed. Orders stay on their original
  -- event by design, so their counts must not move at all. A mismatch means
  -- something other than this function wrote to these events mid-move (a
  -- trigger, a cascade, a path that skipped the locks), and the ledger no
  -- longer describes what happened. RAISE so the whole move rolls back,
  -- operation row included, and the same operation_id can be retried.
  IF v_moved IS DISTINCT FROM (v_before->>'source_active_ticket_count')::integer
     OR (v_after->>'source_active_ticket_count')::integer <> 0
     OR (v_after->>'source_ticket_count')::integer
        <> (v_before->>'source_ticket_count')::integer - v_moved
     OR (v_after->>'destination_ticket_count')::integer
        <> (v_before->>'destination_ticket_count')::integer + v_moved
     OR (v_after->>'source_refunded_void_count')::integer
        <> (v_before->>'source_refunded_void_count')::integer
     OR (v_after->>'source_order_count')::integer
        <> (v_before->>'source_order_count')::integer
     OR (v_after->>'source_order_total_cents')::bigint
        <> (v_before->>'source_order_total_cents')::bigint
     OR (v_after->>'destination_order_count')::integer
        <> (v_before->>'destination_order_count')::integer
     OR (v_after->>'source_order_addon_count')::integer
        <> (v_before->>'source_order_addon_count')::integer - v_moved_addons
     OR (v_after->>'destination_order_addon_count')::integer
        <> (v_before->>'destination_order_addon_count')::integer + v_moved_addons
     OR (v_after->>'source_addon_sold')::bigint
        <> (v_before->>'source_addon_sold')::bigint - v_moved_addon_qty
     OR (v_after->>'destination_addon_sold')::bigint
        <> (v_before->>'destination_addon_sold')::bigint + v_moved_addon_qty
     OR (v_after->>'destination_foreign_addon_count')::integer
        <> (v_before->>'destination_foreign_addon_count')::integer
     OR (v_after->>'source_checkin_count')::integer
        <> (v_before->>'source_checkin_count')::integer - v_moved_checkins
     OR (v_after->>'destination_checkin_count')::integer
        <> (v_before->>'destination_checkin_count')::integer + v_moved_checkins
  THEN
    RAISE EXCEPTION 'event_consolidation_snapshot_mismatch: moved % tickets, % add-ons, % check-ins; before=% after=%',
      v_moved, v_moved_addons, v_moved_checkins, v_before, v_after
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.event_consolidation_operations
  SET status='completed', moved_count=v_moved, after_snapshot=v_after, completed_at=now()
  WHERE operation_id=p_operation_id;

  RETURN jsonb_build_object('ok', true, 'moved_count', v_moved,
    'moved_addon_count', v_moved_addons, 'moved_addon_quantity', v_moved_addon_qty,
    'moved_checkin_count', v_moved_checkins,
    'after', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.execute_event_consolidation(integer, integer, text, uuid, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_event_consolidation(integer, integer, text, uuid, text, jsonb, jsonb)
  TO service_role;
