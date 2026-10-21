-- SOURCE ONLY. Apply before deploying the new ticket-refund cancel_free action.
-- No backfill, monetary refund, order mutation, or add-on mutation is performed.
-- A ticket status CAS, released seat, RSVP and Wallet invalidation must commit
-- together. Separate REST updates cannot safely implement this operation.
CREATE OR REPLACE FUNCTION public.cancel_free_ticket(
  p_ticket_id uuid, p_user_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_initial_event integer;
  v_initial_tier uuid;
  v_now timestamptz;
  v_policy text;
  v_updated integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
  END IF;
  SELECT event_id, ticket_type_id INTO v_initial_event, v_initial_tier
    FROM public.tickets WHERE id = p_ticket_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;

  -- Serialize separate cancellations for one person's event, including
  -- tier-less RSVP tickets, so the last valid ticket clears RSVP exactly once.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'cancel_free_ticket:' || v_initial_event::text || ':' || p_user_id, 0));
  -- Match issuance's inventory-before-attendance lock order. Do not take the
  -- event row before its tier: issuance holds the tier before its ticket's
  -- attendance trigger updates the event.
  IF v_initial_tier IS NOT NULL THEN
    PERFORM 1 FROM public.ticket_types WHERE id = v_initial_tier FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found'); END IF;
  END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
  END IF;
  IF v_ticket.event_id IS DISTINCT FROM v_initial_event OR
     v_ticket.ticket_type_id IS DISTINCT FROM v_initial_tier THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ticket_changed');
  END IF;
  IF v_ticket.purchase_amount_cents IS DISTINCT FROM 0 OR
     v_ticket.checked_in_at IS NOT NULL OR v_ticket.transferred_from IS NOT NULL OR
     v_ticket.cart_line_item_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;
  IF v_ticket.order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_ticket.order_id FOR SHARE;
    IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_user_id OR
       v_order.event_id IS DISTINCT FROM v_ticket.event_id OR
       v_order.status IS DISTINCT FROM 'paid' OR v_order.total_cents IS DISTINCT FROM 0 OR
       v_order.cart_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
    END IF;
  ELSIF v_ticket.cart_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;
  IF v_ticket.status = 'void' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'ticket_id', p_ticket_id);
  END IF;
  IF v_ticket.status IS DISTINCT FROM 'active' OR EXISTS (
    SELECT 1 FROM public.ticket_transfers WHERE ticket_id = p_ticket_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_cancellable');
  END IF;

  -- Legacy comp issuers still lock event before tier. Do not wait on their
  -- event while holding this tier: fail/rollback with 55P03 instead of creating
  -- a tier -> event -> tier deadlock. The caller can retry after that issuer.
  SELECT * INTO v_event FROM public.events WHERE id = v_ticket.event_id FOR UPDATE NOWAIT;
  v_now := clock_timestamp();
  IF NOT FOUND OR v_event.start_date IS NULL OR NOT isfinite(v_event.start_date) OR
     v_event.start_date <= v_now + interval '24 hours' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'window_closed');
  END IF;
  v_policy := coalesce(v_event.refund_policy, 'before_event');
  IF v_policy NOT IN ('before_event', 'days_before', 'always') OR
     (v_policy = 'days_before' AND
       (coalesce(v_event.refund_days_before, 0) < 0 OR
        v_now > v_event.start_date - coalesce(v_event.refund_days_before, 0) * interval '1 day')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'window_closed');
  END IF;

  UPDATE public.tickets SET status = 'void', wallet_voided_at = v_now,
    wallet_last_pushed_at = v_now
    WHERE id = p_ticket_id AND status = 'active' AND checked_in_at IS NULL
      AND user_id = p_user_id AND purchase_amount_cents = 0
      AND transferred_from IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ticket_changed');
  END IF;
  IF v_ticket.ticket_type_id IS NOT NULL THEN
    UPDATE public.ticket_types SET quantity_sold = greatest(0, coalesce(quantity_sold, 0) - 1)
      WHERE id = v_ticket.ticket_type_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tickets WHERE event_id = v_ticket.event_id AND user_id = p_user_id
      AND status IN ('active', 'scanned', 'transfer_pending')
  ) THEN
    UPDATE public.event_rsvps SET status = 'not_going'
      WHERE event_id = v_ticket.event_id AND user_id = p_user_id AND status = 'going';
  END IF;
  -- Existing ticket/RSVP triggers own total_attendees. Wallet invalidation is
  -- committed above even if post-commit APNs/waitlist notification fails.
  RETURN jsonb_build_object('ok', true, 'changed', true, 'ticket_id', p_ticket_id,
    'event_id', v_ticket.event_id, 'ticket_type_id', v_ticket.ticket_type_id);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_free_ticket(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_free_ticket(uuid, text) TO service_role;
NOTIFY pgrst, 'reload schema';
