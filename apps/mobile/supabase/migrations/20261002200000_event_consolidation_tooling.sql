BEGIN;

CREATE TABLE IF NOT EXISTS public.event_consolidation_operations (
  operation_id uuid PRIMARY KEY,
  source_event_id integer NOT NULL REFERENCES public.events(id),
  destination_event_id integer NOT NULL REFERENCES public.events(id),
  actor_auth_id text NOT NULL,
  preflight_hash text NOT NULL,
  ticket_type_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  moved_count integer NOT NULL DEFAULT 0,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.event_consolidation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_consolidation_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.event_consolidation_operations TO service_role;

CREATE TABLE IF NOT EXISTS public.event_consolidation_ticket_ledger (
  operation_id uuid NOT NULL REFERENCES public.event_consolidation_operations(operation_id),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id),
  source_event_id integer NOT NULL,
  destination_event_id integer NOT NULL,
  source_ticket_type_id uuid,
  destination_ticket_type_id uuid,
  moved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, ticket_id)
);
ALTER TABLE public.event_consolidation_ticket_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_consolidation_ticket_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.event_consolidation_ticket_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.event_consolidation_snapshot(
  p_source_event_id integer,
  p_destination_event_id integer
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
WITH source_tickets AS (
  SELECT id, ticket_type_id, status, user_id, guest_email, guest_lookup_token,
         purchase_amount_cents, qr_token
  FROM public.tickets WHERE event_id = p_source_event_id
), destination_tickets AS (
  SELECT id, ticket_type_id, status, user_id, guest_email, purchase_amount_cents
  FROM public.tickets WHERE event_id = p_destination_event_id
), source_orders AS (
  SELECT id, status, total_cents, stripe_payment_intent_id, stripe_checkout_session_id
  FROM public.orders WHERE event_id = p_source_event_id
), destination_orders AS (
  SELECT id, status, total_cents, stripe_payment_intent_id, stripe_checkout_session_id
  FROM public.orders WHERE event_id = p_destination_event_id
)
SELECT jsonb_build_object(
  'source_event_id', p_source_event_id,
  'destination_event_id', p_destination_event_id,
  'source_ticket_count', (SELECT count(*) FROM source_tickets),
  'destination_ticket_count', (SELECT count(*) FROM destination_tickets),
  'source_active_ticket_count', (SELECT count(*) FROM source_tickets WHERE status IN ('active','scanned','transfer_pending')),
  'source_refunded_void_count', (SELECT count(*) FROM source_tickets WHERE status IN ('refunded','void')),
  'source_guest_ticket_count', (SELECT count(*) FROM source_tickets WHERE guest_email IS NOT NULL OR guest_lookup_token IS NOT NULL),
  'source_member_ticket_count', (SELECT count(*) FROM source_tickets WHERE user_id IS NOT NULL),
  'source_ticket_face_value_cents', (SELECT COALESCE(sum(purchase_amount_cents),0) FROM source_tickets),
  'source_order_count', (SELECT count(*) FROM source_orders),
  'source_order_total_cents', (SELECT COALESCE(sum(total_cents),0) FROM source_orders WHERE status IN ('paid','refunded','partially_refunded')),
  'destination_order_count', (SELECT count(*) FROM destination_orders),
  'fingerprint', md5(COALESCE((
    SELECT string_agg(
      id::text || ':' || COALESCE(ticket_type_id::text,'') || ':' || status || ':' ||
      COALESCE(user_id::text,'') || ':' || COALESCE(guest_email,'') || ':' ||
      COALESCE(purchase_amount_cents::text,''),
      '|' ORDER BY id::text
    ) FROM source_tickets
  ), 'empty'))
);
$$;
REVOKE ALL ON FUNCTION public.event_consolidation_snapshot(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_consolidation_snapshot(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_event_consolidation(
  p_source_event_id integer,
  p_destination_event_id integer,
  p_actor_auth_id text,
  p_operation_id uuid,
  p_expected_preflight_hash text,
  p_ticket_type_map jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_source public.events%ROWTYPE;
  v_destination public.events%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_moved integer := 0;
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

  -- tickets.ticket_type_id is nullable on purpose, so free RSVP tickets can
  -- exist without a tier (20260334_tickets_nullable_ticket_type.sql). The
  -- original predicate was `NOT (map ? t.ticket_type_id::text)`, and
  -- `jsonb ? NULL` evaluates to NULL rather than true, so a NULL-tier row was
  -- never flagged. The UPDATE below has no tier filter, so those tickets did
  -- move, with `map->>NULL` giving them a NULL destination tier — invisible to
  -- the per-tier quantity_sold recompute and to the capacity check above.
  -- Refuse the whole operation instead: moving untracked admissions silently
  -- is the defect, and a caller that wants them moved has to say where to.
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

  -- Capacity. Both sibling issuance RPCs guard quantity_total; the move did
  -- not reference it at all, so 200 source tickets could land in a 50-capacity
  -- tier. quantity_sold then reads over quantity_total: the tier shows sold out
  -- to buyers while the door admits every holder, with no way to unwind it.
  -- NULL quantity_total means unlimited, so it is skipped rather than treated
  -- as zero.
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
      AND COALESCE(tt.quantity_sold, 0) + m.incoming > tt.quantity_total
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Destination tier capacity would be exceeded');
  END IF;

  INSERT INTO public.event_consolidation_operations(
    operation_id, source_event_id, destination_event_id, actor_auth_id,
    preflight_hash, ticket_type_map, before_snapshot
  ) VALUES (
    p_operation_id, p_source_event_id, p_destination_event_id, p_actor_auth_id,
    p_expected_preflight_hash, p_ticket_type_map, v_before
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

  UPDATE public.tickets t
  SET event_id = p_destination_event_id,
      ticket_type_id = (p_ticket_type_map->>t.ticket_type_id::text)::uuid
  WHERE t.event_id = p_source_event_id
    AND t.status IN ('active','scanned','transfer_pending');
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Recompute sold inventory from authoritative active admission rows. Historical
  -- orders/payment/refund rows remain on their original event intentionally.
  UPDATE public.ticket_types tt
  SET quantity_sold = (
    SELECT count(*) FROM public.tickets t
    WHERE t.ticket_type_id = tt.id
      AND t.status IN ('active','scanned','transfer_pending')
  )
  WHERE tt.event_id IN (p_source_event_id, p_destination_event_id);

  -- events.total_attendees has to be recomputed here too. Its maintaining
  -- trigger is AFTER INSERT OR UPDATE OF status OR DELETE, so changing
  -- tickets.event_id never fires it, and the body only branches on status
  -- transitions. Left alone, the source keeps counting every moved ticket and
  -- the destination never counts any, which both get-host-dashboard and
  -- get_event_detail read. The drift is also self-sealing: a later refund
  -- decrements the destination, which was never incremented, and GREATEST(,0)
  -- floors it, so the source's inflation could never be worked off.
  UPDATE public.events e
  SET total_attendees = (
    SELECT count(*)::integer FROM public.tickets t
    WHERE t.event_id = e.id AND t.status = 'active'
  )
  WHERE e.id IN (p_source_event_id, p_destination_event_id);

  v_after := public.event_consolidation_snapshot(p_source_event_id, p_destination_event_id);
  UPDATE public.event_consolidation_operations
  SET status='completed', moved_count=v_moved, after_snapshot=v_after, completed_at=now()
  WHERE operation_id=p_operation_id;

  RETURN jsonb_build_object('ok', true, 'moved_count', v_moved, 'after', v_after);
END;
$$;
REVOKE ALL ON FUNCTION public.execute_event_consolidation(integer, integer, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_event_consolidation(integer, integer, text, uuid, text, jsonb)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
