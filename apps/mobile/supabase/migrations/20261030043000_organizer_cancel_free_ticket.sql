-- Organizer correction of an unused, exact-zero admission. No existing rows are
-- changed by this migration. Historical comp provenance is not inferred.
BEGIN;
CREATE TABLE public.organizer_free_ticket_cancellations (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id),
  event_id integer NOT NULL REFERENCES public.events(id),
  actor_id text NOT NULL,
  owner_id text NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  previous_status text NOT NULL CHECK (previous_status = 'active'),
  previous_quantity_sold integer NOT NULL CHECK (previous_quantity_sold > 0),
  cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.organizer_free_ticket_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organizer_free_ticket_cancellations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.organizer_free_ticket_cancellations TO service_role;
-- No direct INSERT/UPDATE/DELETE grant: the function owner writes the audit in
-- the same transaction as cancellation. API roles cannot rewrite its history.
CREATE OR REPLACE FUNCTION public.organizer_cancel_free_ticket(
  p_ticket_id uuid, p_event_id integer, p_actor_id text,
  p_expected_owner_id text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_audit public.organizer_free_ticket_cancellations%ROWTYPE;
  v_tier uuid;
  v_sold integer;
  v_now timestamptz;
  v_reason text := btrim(p_reason);
BEGIN
  IF p_actor_id IS NULL OR btrim(p_actor_id) = '' OR p_expected_owner_id IS NULL
     OR btrim(p_expected_owner_id) = '' OR p_event_id IS NULL OR p_ticket_id IS NULL
     OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  -- Share issuance's per-event mutex; serialize with self-service cancellation
  -- for the same holder so RSVP reconciliation cannot lose a last-ticket race.
  PERFORM pg_advisory_xact_lock(hashtext('comp-event'), p_event_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'cancel_free_ticket:' || p_event_id::text || ':' || p_expected_owner_id, 0));
  SELECT ticket_type_id INTO v_tier FROM public.tickets
    WHERE id = p_ticket_id AND event_id = p_event_id;
  IF NOT FOUND OR v_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;
  -- Inventory before ticket matches checkout. Event lock is NOWAIT below:
  -- legacy event-before-tier issuers must not create a circular wait.
  SELECT quantity_sold INTO v_sold FROM public.ticket_types
    WHERE id = v_tier AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable'); END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.event_id IS DISTINCT FROM p_event_id
     OR v_ticket.ticket_type_id IS DISTINCT FROM v_tier
     OR v_ticket.user_id IS DISTINCT FROM p_expected_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ticket_changed');
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR v_event.host_id IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  SELECT * INTO v_audit FROM public.organizer_free_ticket_cancellations WHERE ticket_id = p_ticket_id;
  IF FOUND THEN
    IF v_audit.actor_id = p_actor_id AND v_audit.event_id = p_event_id
       AND v_audit.owner_id = p_expected_owner_id AND v_audit.reason = v_reason
       AND v_ticket.status = 'void' THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'ticket_id', p_ticket_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'cancellation_conflict');
  END IF;
  IF v_ticket.status IS DISTINCT FROM 'active' OR v_ticket.category IS DISTINCT FROM 'admission'
     OR v_ticket.purchase_amount_cents IS DISTINCT FROM 0
     OR v_ticket.checked_in_at IS NOT NULL OR v_ticket.checked_in_by IS NOT NULL
     OR v_ticket.transferred_from IS NOT NULL OR v_ticket.cart_id IS NOT NULL
     OR v_ticket.cart_line_item_id IS NOT NULL OR v_ticket.stripe_payment_intent_id IS NOT NULL
     OR v_ticket.stripe_checkout_session_id IS NOT NULL OR v_ticket.order_id IS NULL
     OR v_ticket.guest_email IS NOT NULL OR v_ticket.guest_phone IS NOT NULL
     OR v_ticket.guest_phone_e164 IS NOT NULL OR v_ticket.guest_lookup_token IS NOT NULL
     OR v_ticket.claimed_by IS NOT NULL OR v_ticket.claimed_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.ticket_transfers WHERE ticket_id = p_ticket_id
       AND status IN ('pending', 'accepted')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_ticket.order_id FOR SHARE;
  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_expected_owner_id
     OR v_order.event_id IS DISTINCT FROM p_event_id OR v_order.type IS DISTINCT FROM 'event_ticket'
     OR v_order.status IS DISTINCT FROM 'paid' OR v_order.total_cents IS DISTINCT FROM 0
     OR v_order.subtotal_cents IS DISTINCT FROM 0 OR v_order.stripe_payment_intent_id IS NOT NULL
     OR v_order.stripe_checkout_session_id IS NOT NULL OR v_order.cart_id IS NOT NULL
     OR v_order.promo_code_id IS NOT NULL OR coalesce(v_order.discount_cents, 0) <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;
  IF v_sold IS NULL OR v_sold < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'inventory_inconsistent');
  END IF;
  v_now := clock_timestamp();
  INSERT INTO public.organizer_free_ticket_cancellations
    (ticket_id, event_id, actor_id, owner_id, reason, previous_status, previous_quantity_sold, cancelled_at)
    VALUES (p_ticket_id, p_event_id, p_actor_id, p_expected_owner_id, v_reason, 'active', v_sold, v_now);
  UPDATE public.tickets SET status = 'void', wallet_voided_at = v_now,
    wallet_last_pushed_at = v_now, updated_at = v_now WHERE id = p_ticket_id;
  UPDATE public.ticket_types SET quantity_sold = quantity_sold - 1 WHERE id = v_tier;
  IF NOT EXISTS (SELECT 1 FROM public.tickets WHERE event_id = p_event_id
      AND user_id = p_expected_owner_id AND status IN ('active','scanned','transfer_pending')) THEN
    UPDATE public.event_rsvps SET status = 'not_going'
      WHERE event_id = p_event_id AND user_id = p_expected_owner_id AND status = 'going';
  END IF;
  -- Existing attendance triggers own event counters. No refund, order rewrite,
  -- reissue, push, email or waitlist promotion is performed here.
  RETURN jsonb_build_object('ok', true, 'changed', true, 'ticket_id', p_ticket_id,
    'event_id', p_event_id, 'ticket_type_id', v_tier);
END;
$$;
REVOKE ALL ON FUNCTION public.organizer_cancel_free_ticket(uuid, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organizer_cancel_free_ticket(uuid, integer, text, text, text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
