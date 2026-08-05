-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260710115159 :: fix_issue_rsvp_ticket_gen_random_bytes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- issue_rsvp_ticket used gen_random_bytes (pgcrypto, lives in the `extensions`
-- schema) but its search_path was only public,pg_temp — so the function threw
-- "gen_random_bytes does not exist" on EVERY call, and no RSVP ever got a
-- ticket (web AND native). Add `extensions` to the search_path.
CREATE OR REPLACE FUNCTION public.issue_rsvp_ticket(p_event_id integer, p_user_auth_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;;
