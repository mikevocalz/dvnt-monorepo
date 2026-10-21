-- Source-only rollout: apply before deploying the matching paid-issuance adapters.
-- No historical rows are rewritten. This RPC covers single-tier paid hosted
-- Checkout Sessions and native/door PaymentIntents, not carts or free issuance.
CREATE OR REPLACE FUNCTION public.paid_ticket_issuance_atomic(
  p_order_id uuid,
  p_ticket_type_id uuid,
  p_payment_intent_id text,
  p_checkout_session_id text,
  p_amount_cents bigint,
  p_ticket_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_quantity integer;
  v_count integer;
  v_hold_key text;
  v_hold_ids uuid[];
  v_own_held bigint;
  v_actual_sold bigint;
  v_sold bigint;
  v_other_held bigint;
  v_available bigint;
  v_result_tickets jsonb;
BEGIN
  IF p_order_id IS NULL OR p_ticket_type_id IS NULL
     OR p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     OR (p_checkout_session_id IS NOT NULL AND p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$')
     OR jsonb_typeof(p_ticket_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request', 'needs_recovery', true);
  END IF;

  -- Serialize both rails by the authoritative payment, even across orders and
  -- tiers. Then take the tier before the order, consistent with free issuance.
  PERFORM pg_advisory_xact_lock(hashtextextended('paid_ticket_issuance:' || p_payment_intent_id, 0));
  SELECT * INTO v_tier FROM public.ticket_types WHERE id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found', 'needs_recovery', true);
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found', 'needs_recovery', true);
  END IF;
  v_quantity := v_order.quantity;
  v_hold_key := coalesce(p_checkout_session_id, p_payment_intent_id);
  IF v_order.type IS DISTINCT FROM 'event_ticket' OR v_order.cart_id IS NOT NULL
     OR v_order.event_id IS DISTINCT FROM v_tier.event_id
     OR v_quantity IS NULL OR v_quantity < 1
     OR (v_order.user_id IS NULL AND NULLIF(btrim(v_order.guest_email), '') IS NULL)
     OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
     OR (p_checkout_session_id IS NULL AND
         v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id)
     OR (v_order.stripe_payment_intent_id IS NOT NULL AND
         v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_mismatch', 'needs_recovery', true);
  END IF;
  -- Legacy orders have no uniqueness constraint on Stripe references. Do not
  -- silently choose a winner or attach one purchase to a second order.
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id <> p_order_id AND
      (o.stripe_payment_intent_id = p_payment_intent_id OR
       (p_checkout_session_id IS NOT NULL AND o.stripe_checkout_session_id = p_checkout_session_id))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_conflict', 'needs_recovery', true);
  END IF;
  IF v_order.status IN ('refunded', 'partially_refunded', 'disputed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', true, 'terminal', true, 'duplicate', true,
      'order_id', p_order_id, 'issued_count', 0, 'tickets', '[]'::jsonb);
  END IF;
  IF v_order.status IS NULL OR v_order.status NOT IN ('created', 'payment_pending', 'payment_failed', 'paid')
     OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR v_order.total_cents::bigint IS DISTINCT FROM p_amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_mismatch', 'needs_recovery', true);
  END IF;

  -- Recognize old ticket rows linked by payment/session before order_id existed.
  -- Never fill a partial set or overwrite a contradictory legacy association.
  SELECT count(*) INTO v_count FROM public.tickets t WHERE t.order_id = p_order_id
    OR t.stripe_payment_intent_id = p_payment_intent_id
    OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id);
  IF v_count > 0 THEN
    IF v_count <> v_quantity OR EXISTS (SELECT 1 FROM public.tickets t WHERE
      (t.order_id = p_order_id OR t.stripe_payment_intent_id = p_payment_intent_id
       OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id)) AND
      (t.event_id IS DISTINCT FROM v_order.event_id OR t.ticket_type_id IS DISTINCT FROM p_ticket_type_id
       OR (t.order_id IS NOT NULL AND t.order_id IS DISTINCT FROM p_order_id)
       OR (t.stripe_payment_intent_id IS NOT NULL AND t.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id)
       OR (t.stripe_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id)
       OR t.cart_id IS NOT NULL OR t.user_id IS DISTINCT FROM v_order.user_id
       OR (t.order_count IS NOT NULL AND t.order_count <> v_quantity)
       OR (t.order_index IS NOT NULL AND (t.order_index < 1 OR t.order_index > v_quantity))
       OR (v_order.user_id IS NULL AND lower(btrim(t.guest_email)) IS DISTINCT FROM lower(btrim(v_order.guest_email))))) OR EXISTS (
      SELECT 1 FROM public.tickets t WHERE
        (t.order_id = p_order_id OR t.stripe_payment_intent_id = p_payment_intent_id
         OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id))
        AND t.order_index IS NOT NULL GROUP BY t.order_index HAVING count(*) > 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'existing_tickets_mismatch', 'needs_recovery', true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.tickets t WHERE
      (t.order_id = p_order_id OR t.stripe_payment_intent_id = p_payment_intent_id
       OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id))
      AND t.status IN ('refunded', 'void')) THEN
      RETURN jsonb_build_object('ok', true, 'terminal', true, 'duplicate', true,
        'order_id', p_order_id, 'issued_count', 0, 'tickets', '[]'::jsonb);
    END IF;
    IF EXISTS (SELECT 1 FROM public.tickets t WHERE
      (t.order_id = p_order_id OR t.stripe_payment_intent_id = p_payment_intent_id
       OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id))
      AND (NULLIF(btrim(t.qr_token), '') IS NULL OR t.status IS NULL
           OR t.status NOT IN ('active', 'scanned', 'transfer_pending'))) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'existing_tickets_invalid', 'needs_recovery', true);
    END IF;
  END IF;

  -- The trusted adapter supplies verified Stripe amount and signed QR rows.
  -- Validate their purchase/identity context, then fix authoritative fields on
  -- insert. Exact integer allocation avoids multi-ticket rounding drift.
  IF v_count = 0 AND (jsonb_array_length(p_ticket_rows) <> v_quantity OR EXISTS (
    SELECT 1 FROM jsonb_populate_recordset(NULL::public.tickets, p_ticket_rows) t
    WHERE t.id IS NULL OR NULLIF(btrim(t.qr_token), '') IS NULL OR NULLIF(btrim(t.qr_payload), '') IS NULL
      OR t.event_id IS DISTINCT FROM v_order.event_id OR t.ticket_type_id IS DISTINCT FROM p_ticket_type_id
      OR t.order_id IS DISTINCT FROM p_order_id OR t.user_id IS DISTINCT FROM v_order.user_id
      OR (v_order.user_id IS NULL AND (NULLIF(btrim(t.guest_lookup_token), '') IS NULL
          OR lower(btrim(t.guest_email)) IS DISTINCT FROM lower(btrim(v_order.guest_email))))
      OR t.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
      OR t.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
      OR t.purchase_amount_cents IS NULL OR t.purchase_amount_cents < 0
      OR t.cart_id IS NOT NULL OR t.cart_line_item_id IS NOT NULL
  ) OR (SELECT sum(t.purchase_amount_cents::bigint)
        FROM jsonb_populate_recordset(NULL::public.tickets, p_ticket_rows) t) IS DISTINCT FROM p_amount_cents) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows', 'needs_recovery', true);
  END IF;

  -- Lock matching holds so expiry/conversion cannot invalidate allocation
  -- halfway through issuance. Hosted holds use the session ID in this legacy
  -- column; native/door holds use the PI. Door reservations belong to the
  -- recorded seller, but ticket ownership always belongs to the guest.
  PERFORM 1 FROM public.ticket_holds h
    WHERE h.payment_intent_id IN (p_payment_intent_id, p_checkout_session_id)
    ORDER BY h.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.ticket_holds h
    WHERE h.payment_intent_id IN (p_payment_intent_id, p_checkout_session_id) AND h.status = 'active'
      AND (h.payment_intent_id IS DISTINCT FROM v_hold_key
       OR h.ticket_type_id IS DISTINCT FROM p_ticket_type_id OR h.event_id IS DISTINCT FROM v_order.event_id
       OR h.quantity <= 0
       OR NOT (CASE WHEN v_order.user_id IS NOT NULL THEN h.user_id IS NOT DISTINCT FROM v_order.user_id
              WHEN p_checkout_session_id IS NULL AND v_order.sold_by_staff_user_id IS NOT NULL
                THEN h.user_id IS NOT DISTINCT FROM v_order.sold_by_staff_user_id AND h.guest_email IS NULL
              ELSE h.user_id IS NULL AND lower(btrim(h.guest_email)) IS NOT DISTINCT FROM lower(btrim(v_order.guest_email)) END))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_mismatch', 'needs_recovery', true);
  END IF;
  IF v_count > 0 THEN
    -- Repair an old split fulfillment without minting or charging again. A
    -- complete issued bundle no longer needs a live reservation, but any
    -- still-active canonical reservation must be coherent before conversion.
    SELECT array_agg(h.id), coalesce(sum(h.quantity), 0) INTO v_hold_ids, v_own_held
      FROM public.ticket_holds h WHERE h.payment_intent_id = v_hold_key AND h.status = 'active';
    IF v_own_held > 0 AND v_own_held <> v_quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'hold_mismatch', 'needs_recovery', true);
    END IF;
    SELECT count(*) INTO v_actual_sold FROM public.tickets WHERE ticket_type_id = p_ticket_type_id
      AND status IS DISTINCT FROM 'refunded' AND status IS DISTINCT FROM 'void';
    v_sold := greatest(coalesce(v_tier.quantity_sold, 0)::bigint, v_actual_sold);
    UPDATE public.ticket_types SET quantity_sold = v_sold
      WHERE id = p_ticket_type_id AND quantity_sold IS DISTINCT FROM v_sold;
    UPDATE public.ticket_holds SET status = 'converted' WHERE id = ANY(v_hold_ids);
    UPDATE public.orders SET stripe_payment_intent_id = p_payment_intent_id, updated_at = now()
      WHERE id = p_order_id AND stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id;
    SELECT jsonb_agg(jsonb_build_object('id', t.id, 'qr_token', t.qr_token,
      'guest_lookup_token', t.guest_lookup_token) ORDER BY t.order_index NULLS LAST, t.id)
      INTO v_result_tickets FROM public.tickets t WHERE t.order_id = p_order_id
      OR t.stripe_payment_intent_id = p_payment_intent_id
      OR (p_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id = p_checkout_session_id);
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'order_id', p_order_id,
      'issued_count', 0, 'tickets', v_result_tickets);
  END IF;
  SELECT array_agg(h.id), coalesce(sum(h.quantity), 0) INTO v_hold_ids, v_own_held
    FROM public.ticket_holds h WHERE h.payment_intent_id = v_hold_key AND h.status = 'active'
      AND h.expires_at > clock_timestamp();
  IF v_own_held <> v_quantity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'allocation_missing', 'needs_recovery', true);
  END IF;

  -- Use one coherent snapshot of actual kept tickets and ALL other live holds.
  -- A stale legacy absolute writer can lower quantity_sold, never this floor.
  -- Overcounts/double-counted legacy handoffs fail conservatively. This does
  -- not perform a historical reconciliation sweep or make other writers atomic.
  SELECT
    (SELECT count(*) FROM public.tickets WHERE ticket_type_id = p_ticket_type_id
      AND status IS DISTINCT FROM 'refunded' AND status IS DISTINCT FROM 'void'),
    (SELECT coalesce(sum(qty), 0) FROM (
      SELECT quantity AS qty FROM public.ticket_holds WHERE ticket_type_id = p_ticket_type_id
        AND status = 'active' AND expires_at > clock_timestamp() AND NOT (id = ANY(v_hold_ids))
      UNION ALL
      SELECT qty FROM public.cart_holds WHERE tier_id = p_ticket_type_id
        AND released = false AND expires_at > clock_timestamp()
    ) holds)
  INTO v_actual_sold, v_other_held;
  v_sold := greatest(coalesce(v_tier.quantity_sold, 0)::bigint, v_actual_sold);
  IF v_tier.quantity_total IS NOT NULL THEN
    v_available := v_tier.quantity_total::bigint - v_sold - v_other_held;
    IF v_available < v_quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_inventory',
        'needs_recovery', true, 'available', greatest(v_available, 0));
    END IF;
  END IF;

  INSERT INTO public.tickets (
    id, event_id, ticket_type_id, user_id, guest_email, guest_name, attendee_name,
    guest_lookup_token, status, qr_token, qr_payload, purchase_amount_cents,
    stripe_payment_intent_id, stripe_checkout_session_id, order_id, order_index, order_count
  ) SELECT t.id, v_order.event_id, p_ticket_type_id, v_order.user_id,
      CASE WHEN v_order.guest_email IS NOT NULL THEN lower(btrim(v_order.guest_email)) ELSE NULL END,
      t.guest_name, t.attendee_name, t.guest_lookup_token, 'active', t.qr_token, t.qr_payload,
      t.purchase_amount_cents, p_payment_intent_id, p_checkout_session_id,
      p_order_id, r.ordinality::integer, v_quantity
    FROM jsonb_array_elements(p_ticket_rows) WITH ORDINALITY r(value, ordinality)
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public.tickets, r.value) t;
  UPDATE public.ticket_types SET quantity_sold = v_sold + v_quantity WHERE id = p_ticket_type_id;
  UPDATE public.ticket_holds SET status = 'converted' WHERE id = ANY(v_hold_ids);
  UPDATE public.orders SET stripe_payment_intent_id = p_payment_intent_id, updated_at = now()
    WHERE id = p_order_id;
  SELECT jsonb_agg(jsonb_build_object('id', t.id, 'qr_token', t.qr_token,
    'guest_lookup_token', t.guest_lookup_token) ORDER BY t.order_index) INTO v_result_tickets
    FROM public.tickets t WHERE t.order_id = p_order_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'order_id', p_order_id,
    'issued_count', v_quantity, 'tickets', v_result_tickets);
END;
$$;
REVOKE ALL ON FUNCTION public.paid_ticket_issuance_atomic(uuid, uuid, text, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paid_ticket_issuance_atomic(uuid, uuid, text, text, bigint, jsonb)
  TO service_role;

-- Shared legacy-hold admission: prevent known stale-counter undercounts from
-- accepting additional allocations before payment. Cart admission and free
-- writers bypassing this RPC are not changed by this bounded replacement.
create or replace function public.ticket_hold_create_atomic(
  p_ticket_type_id uuid,
  p_quantity integer,
  p_payment_intent_id text default null,
  p_user_id text default null,
  p_guest_email text default null,
  p_hold_seconds integer default 600,
  p_hold_kind text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tier public.ticket_types%rowtype;
  v_cart_held bigint;
  v_legacy_held bigint;
  v_actual_sold bigint;
  v_available bigint;
  v_expires_at timestamptz :=
    now() + make_interval(secs => greatest(60, least(coalesce(p_hold_seconds, 600), 604800)));
  v_hold_id uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;

  -- The lock that makes this atomic. Every concurrent buyer of this tier
  -- serialises here, so the count below can't go stale before the insert.
  select * into v_tier
  from public.ticket_types
  where id = p_ticket_type_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'tier_not_found');
  end if;

  -- Unlimited tier: nothing to oversell.
  if v_tier.quantity_total is null then
    insert into public.ticket_holds (
      user_id, ticket_type_id, event_id, quantity,
      payment_intent_id, status, expires_at, guest_email, hold_kind
    ) values (
      p_user_id, p_ticket_type_id, v_tier.event_id, p_quantity,
      p_payment_intent_id, 'active', v_expires_at, p_guest_email,
      coalesce(p_hold_kind, 'checkout')
    ) returning id into v_hold_id;
    return jsonb_build_object(
      'ok', true, 'holdId', v_hold_id, 'expiresAt', v_expires_at, 'available', null
    );
  end if;

  -- Same lock, signature, TTL and both-hold accounting as the deployed RPC.
  -- A legacy absolute counter writer must not make issued seats disappear at
  -- admission. Read kept tickets and both hold tables in one coherent snapshot.
  -- Counts are conservative: scanned/transfer-pending/null consume inventory;
  -- refunded/void do not. This does not rewrite the recorded sold counter.
  select
    (select count(*) from public.tickets t
      where t.ticket_type_id = p_ticket_type_id
        and t.status is distinct from 'refunded' and t.status is distinct from 'void'),
    (select coalesce(sum(ch.qty), 0) from public.cart_holds ch
      where ch.tier_id = p_ticket_type_id and ch.released = false and ch.expires_at > now()),
    (select coalesce(sum(th.quantity), 0) from public.ticket_holds th
      where th.ticket_type_id = p_ticket_type_id and th.status = 'active' and th.expires_at > now())
  into v_actual_sold, v_cart_held, v_legacy_held;

  v_available := v_tier.quantity_total::bigint
    - greatest(coalesce(v_tier.quantity_sold, 0)::bigint, v_actual_sold)
    - v_cart_held - v_legacy_held;

  if v_available < p_quantity then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_inventory',
      'available', greatest(v_available, 0)
    );
  end if;

  insert into public.ticket_holds (
    user_id, ticket_type_id, event_id, quantity,
    payment_intent_id, status, expires_at, guest_email, hold_kind
  ) values (
    p_user_id, p_ticket_type_id, v_tier.event_id, p_quantity,
    p_payment_intent_id, 'active', v_expires_at, p_guest_email,
    coalesce(p_hold_kind, 'checkout')
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'ok', true,
    'holdId', v_hold_id,
    'expiresAt', v_expires_at,
    'available', v_available - p_quantity
  );
end;
$$;

-- SECURITY DEFINER in public is callable by PUBLIC by default, and this one
-- writes inventory holds. Edge functions call it with the service role, so no
-- client role needs it.
revoke all on function public.ticket_hold_create_atomic(
  uuid, integer, text, text, text, integer, text
) from public, anon, authenticated;

grant execute on function public.ticket_hold_create_atomic(
  uuid, integer, text, text, text, integer, text
) to service_role;


NOTIFY pgrst, 'reload schema';
