-- Issue a ticket for free RSVP events (ticketing feature OFF).
-- Generates a crypto-random QR token server-side so the scanner can validate it.

CREATE OR REPLACE FUNCTION public.issue_rsvp_ticket(
  p_event_id   integer,
  p_user_auth_id text
)
RETURNS JSON AS $$
DECLARE
  v_existing RECORD;
  v_token    text;
  v_ticket   RECORD;
BEGIN
  -- Prevent duplicate: if user already has an active ticket for this event, return it
  SELECT id, qr_token INTO v_existing
  FROM tickets
  WHERE event_id = p_event_id
    AND user_id = p_user_auth_id
    AND status = 'active'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object(
      'id', v_existing.id,
      'qr_token', v_existing.qr_token,
      'already_existed', true
    );
  END IF;

  -- Generate a 32-byte hex token
  v_token := encode(gen_random_bytes(32), 'hex');

  -- Insert ticket row
  INSERT INTO tickets (event_id, user_id, status, qr_token, purchase_amount_cents)
  VALUES (p_event_id, p_user_auth_id, 'active', v_token, 0)
  RETURNING id, qr_token INTO v_ticket;

  RETURN json_build_object(
    'id', v_ticket.id,
    'qr_token', v_ticket.qr_token,
    'already_existed', false
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER;

-- Grants
GRANT EXECUTE ON FUNCTION public.issue_rsvp_ticket(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_rsvp_ticket(integer, text) TO service_role;
