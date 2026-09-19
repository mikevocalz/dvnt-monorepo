-- Guest ticket-email delivery hardening (WS email contract).
--
-- 1) tickets.order_id — the authoritative order ↔ ticket link. Until now
--    tickets related to an order only through stripe_payment_intent_id /
--    stripe_checkout_session_id, and free door tickets had NO link at all
--    (the free RPC inserted tickets without any order reference). The
--    canonical email bundle must be loaded by this link, never by guest
--    email + event (that mixes orders from the same buyer).
-- 2) orders.ticket_email_* — durable per-order delivery state so a Resend
--    outage is a retryable 'failed', not a silent permanent loss, and a
--    webhook replay can self-heal instead of blindly skipping.
-- 3) door_free_sale_atomic re-created to stamp order_id on the tickets it
--    mints.
--
-- Rollback: drop the new columns / re-apply the previous
-- door_free_sale_atomic body (20260919181000). Backfilled order_id values
-- are derived data — dropping the column loses nothing else.

alter table public.tickets
  add column if not exists order_id uuid references public.orders(id);
create index if not exists tickets_order_id_idx on public.tickets(order_id)
  where order_id is not null;

-- Backfill from the legacy links. Free door tickets have no Stripe link;
-- they get order_id going forward via the updated RPC below.
update public.tickets t
  set order_id = o.id
  from public.orders o
  where t.order_id is null
    and t.stripe_payment_intent_id is not null
    and t.stripe_payment_intent_id = o.stripe_payment_intent_id;

update public.tickets t
  set order_id = o.id
  from public.orders o
  where t.order_id is null
    and t.stripe_checkout_session_id is not null
    and t.stripe_checkout_session_id = o.stripe_checkout_session_id;

-- ── Per-order ticket email delivery state ──────────────────────────────
alter table public.orders
  add column if not exists ticket_email_status text,
  add column if not exists ticket_email_attempts integer not null default 0,
  add column if not exists ticket_email_last_attempt_at timestamptz,
  add column if not exists ticket_email_sent_at timestamptz,
  add column if not exists ticket_email_resend_id text,
  add column if not exists ticket_email_last_error text;

alter table public.orders
  drop constraint if exists orders_ticket_email_status_check;
alter table public.orders
  add constraint orders_ticket_email_status_check
  check (ticket_email_status is null
         or ticket_email_status in ('pending', 'sent', 'failed'));

-- ── door_free_sale_atomic — stamp order_id on minted tickets ───────────
CREATE OR REPLACE FUNCTION public.door_free_sale_atomic(
  p_ticket_type_id uuid, p_ticket_rows jsonb, p_order jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_hold jsonb;
  v_order_id uuid;
  v_tickets jsonb;
  v_quantity integer;
BEGIN
  v_order := jsonb_populate_record(NULL::public.orders, p_order);
  v_quantity := jsonb_array_length(p_ticket_rows);
  IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 20
    OR v_order.quantity IS DISTINCT FROM v_quantity
    OR v_order.total_cents IS DISTINCT FROM 0
    OR v_order.subtotal_cents IS DISTINCT FROM 0
    OR v_order.guest_email IS NULL OR v_order.sold_by_staff_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid free door sale';
  END IF;

  SELECT * INTO v_tier FROM public.ticket_types
    WHERE id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND OR v_tier.event_id IS DISTINCT FROM v_order.event_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found');
  END IF;
  v_hold := public.ticket_hold_create_atomic(
    p_ticket_type_id, v_quantity, NULL, NULL, v_order.guest_email, 600, NULL
  );
  IF NOT (v_hold->>'ok')::boolean THEN RETURN v_hold; END IF;

  INSERT INTO public.orders (
    user_id, guest_email, type, status, quantity, currency,
    subtotal_cents, total_cents, event_id, paid_at, sold_by_staff_user_id,
    promo_code_id, discount_cents, promoter_policy_version,
    promoter_original_amount_cents, promoter_customer_discount_bps,
    promoter_discount_amount_cents, promoter_discounted_amount_cents,
    promoter_code, promoter_commission_bps, promoter_commission_amount_cents
  ) VALUES (
    NULL, v_order.guest_email, 'event_ticket', 'paid', v_quantity,
    coalesce(v_order.currency, 'usd'), 0, 0, v_order.event_id, now(),
    v_order.sold_by_staff_user_id, v_order.promo_code_id, v_order.discount_cents,
    v_order.promoter_policy_version, v_order.promoter_original_amount_cents,
    v_order.promoter_customer_discount_bps, v_order.promoter_discount_amount_cents,
    v_order.promoter_discounted_amount_cents, v_order.promoter_code,
    v_order.promoter_commission_bps, 0
  ) RETURNING id INTO v_order_id;

  WITH inserted AS (
    INSERT INTO public.tickets (
      id, event_id, ticket_type_id, user_id, guest_email, guest_name,
      guest_lookup_token, status, qr_token, qr_payload, purchase_amount_cents,
      order_id
    ) SELECT
      t.id, v_order.event_id, p_ticket_type_id, NULL, v_order.guest_email,
      t.guest_name, t.guest_lookup_token, 'active', t.qr_token, t.qr_payload, 0,
      v_order_id
    FROM jsonb_populate_recordset(NULL::public.tickets, p_ticket_rows) AS t
    RETURNING id, qr_token, guest_lookup_token
  ) SELECT jsonb_agg(to_jsonb(inserted)) INTO v_tickets FROM inserted;

  UPDATE public.ticket_types SET quantity_sold = coalesce(quantity_sold, 0) + v_quantity
    WHERE id = p_ticket_type_id;
  UPDATE public.ticket_holds SET status = 'converted'
    WHERE id = (v_hold->>'holdId')::uuid;
  INSERT INTO public.order_timeline (order_id, type, label) VALUES
    (v_order_id, 'created', 'Order created'),
    (v_order_id, 'payment_captured', 'Free door order — no charge');
  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'tickets', v_tickets);
END;
$$;
REVOKE ALL ON FUNCTION public.door_free_sale_atomic(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.door_free_sale_atomic(uuid, jsonb, jsonb)
  TO service_role;
NOTIFY pgrst, 'reload schema';
