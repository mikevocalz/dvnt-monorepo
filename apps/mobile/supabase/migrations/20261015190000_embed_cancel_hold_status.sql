-- ticket_embed_cancel_unattached (20261011233500) set ticket_holds.status to
-- 'released', which ticket_holds_status_check rejects (active, converted,
-- expired). Every cancel of an active hold raised a check violation, so the
-- order stayed payment_pending and the seat stayed held until expiry.
-- Early release follows the existing contract in 20260806100500: the hold
-- becomes 'expired', the same status the payment_failed webhook writes.
-- Body otherwise unchanged. SECURITY DEFINER, search_path and grants unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.ticket_embed_cancel_unattached(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.ticket_embed_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM ticket_embed_checkout_attempts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF a.stripe_session_id IS NULL THEN
    UPDATE ticket_holds SET status='expired', expires_at=LEAST(expires_at, now())
      WHERE id=a.hold_id AND status='active';
    UPDATE orders SET status='payment_failed' WHERE id=a.order_id AND status='payment_pending';
    UPDATE ticket_embed_checkout_attempts SET state='cancelled' WHERE id=a.id RETURNING * INTO a;
  END IF;
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.ticket_embed_cancel_unattached(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_embed_cancel_unattached(uuid) TO service_role;
COMMIT;
