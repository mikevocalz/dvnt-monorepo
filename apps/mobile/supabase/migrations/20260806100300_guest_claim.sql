-- ══════════════════════════════════════════════════════════════
-- Guest → account claim (WS-7 / WS-13)
-- ══════════════════════════════════════════════════════════════
-- Re-parents guest orders and their tickets onto a real account.
--
-- CONTRACT: the caller MUST pass an email it has VERIFIED belongs to
-- p_user_id (the BetterAuth magic-link / OTP callback, after the
-- verification round-trip). This function does no verification of its
-- own — that is why EXECUTE is service_role only and the client can
-- never reach it via /rpc. Passing an unverified, user-typed email
-- here would let anyone claim a stranger's tickets.
--
-- guest_email is PRESERVED on every claimed row for audit — the claim
-- is visible (user_id set + guest_email still present), never silent.
--
-- Idempotent: rows are matched on user_id IS NULL, so a second call
-- with the same email matches nothing and returns zero counts.
--
-- NOTE: user ids in the ticketing domain are BetterAuth text ids
-- (orders.user_id / tickets.user_id are text), so p_user_id is text —
-- not uuid.
CREATE OR REPLACE FUNCTION public.claim_guest_orders(
  p_user_id text,
  p_email   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_orders_claimed  integer := 0;
  v_tickets_claimed integer := 0;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id)) = 0
     OR p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  UPDATE public.orders
  SET user_id    = p_user_id,
      updated_at = now()
  WHERE user_id IS NULL
    AND guest_email IS NOT NULL
    AND lower(guest_email) = lower(p_email);
  GET DIAGNOSTICS v_orders_claimed = ROW_COUNT;

  -- Tickets carry their own guest identity (guest checkout + guest
  -- RSVP paths), so match them directly rather than via orders.
  UPDATE public.tickets
  SET user_id = p_user_id
  WHERE user_id IS NULL
    AND guest_email IS NOT NULL
    AND lower(guest_email) = lower(p_email);
  GET DIAGNOSTICS v_tickets_claimed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'ordersClaimed', v_orders_claimed,
    'ticketsClaimed', v_tickets_claimed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_guest_orders(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_guest_orders(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
