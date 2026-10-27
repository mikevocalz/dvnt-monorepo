-- Acceptance must commit the ownership/credential change and transfer state
-- together. Separate REST writes can strand a ticket after a transient failure.
-- Source-only: no tickets are transferred by applying this function definition.
BEGIN;
CREATE OR REPLACE FUNCTION public.accept_ticket_transfer_atomic(
  p_transfer_id uuid, p_recipient_id text, p_event_id integer,
  p_qr_token text, p_qr_payload text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
DECLARE
  v_transfer public.ticket_transfers%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
BEGIN
  IF p_recipient_id IS NULL OR btrim(p_recipient_id) = ''
     OR p_qr_token IS NULL OR p_qr_token !~ '^[0-9a-f]{64}$'
     OR p_qr_payload IS NULL OR btrim(p_qr_payload) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid transfer request');
  END IF;

  -- Same order as cancellation/decline/expiry: transfer before its ticket.
  SELECT * INTO v_transfer FROM public.ticket_transfers
    WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.to_user_id IS DISTINCT FROM p_recipient_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transfer is not for you');
  END IF;
  IF v_transfer.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transfer already processed');
  END IF;
  IF v_transfer.expires_at IS NULL OR v_transfer.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transfer has expired');
  END IF;

  SELECT * INTO v_ticket FROM public.tickets
    WHERE id = v_transfer.ticket_id FOR UPDATE;
  -- Waiting for another ticket writer can cross the deadline; do not use the
  -- earlier read (or transaction-start now()) as permission to accept late.
  IF v_transfer.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Transfer has expired');
  END IF;
  IF NOT FOUND OR v_ticket.user_id IS DISTINCT FROM v_transfer.from_user_id
     OR v_ticket.event_id IS DISTINCT FROM p_event_id
     OR v_ticket.status IS DISTINCT FROM 'transfer_pending'
     OR v_ticket.checked_in_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This ticket is no longer available to transfer.');
  END IF;

  UPDATE public.tickets SET user_id = p_recipient_id, status = 'active',
    qr_token = p_qr_token, qr_payload = p_qr_payload,
    transferred_from = v_transfer.from_user_id,
    attendee_name = NULL, guest_name = NULL, guest_email = NULL,
    guest_phone = NULL, guest_lookup_token = NULL,
    wallet_serial_number = NULL, wallet_auth_token = NULL,
    wallet_pass_type_id = NULL, wallet_voided_at = NULL, wallet_last_pushed_at = NULL
    WHERE id = v_ticket.id;
  UPDATE public.ticket_transfers SET status = 'accepted', resolved_at = clock_timestamp()
    WHERE id = p_transfer_id;
  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket.id);
END;
$$;
REVOKE ALL ON FUNCTION public.accept_ticket_transfer_atomic(uuid, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer_atomic(uuid, text, integer, text, text)
  TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
