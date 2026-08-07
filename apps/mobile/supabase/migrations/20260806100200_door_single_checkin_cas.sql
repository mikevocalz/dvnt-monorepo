-- ══════════════════════════════════════════════════════════════
-- Door single-check-in CAS (WS-8) — DB-level double-scan protection
-- ══════════════════════════════════════════════════════════════
-- Today double-scan protection is application-level (client cooldown
-- + edge-fn branch). redeem_ticket makes it a database guarantee: the
-- atomic compare-and-swap `UPDATE ... WHERE status = 'active'` means
-- two simultaneous scans of the same QR can never both succeed — the
-- loser sees zero rows and gets the ticket's actual state back.
-- Every call — valid or not — writes a `checkins` audit row.

-- Allow audit rows for unknown QR tokens: an 'invalid' scan of a
-- token with no ticket row has no ticket_id to reference. Event
-- context always exists (the scanner is event-scoped), so event_id
-- stays NOT NULL.
ALTER TABLE checkins ALTER COLUMN ticket_id DROP NOT NULL;
COMMENT ON COLUMN checkins.ticket_id IS
  'NULL only for result=invalid scans of tokens that match no ticket row.';

-- Result mapping (checkins.result CHECK values, 20260313):
--   valid           — CAS won: active → scanned, checked_in_at/by stamped
--   already_scanned — ticket already scanned; returns ORIGINAL checked_in_at/by
--   refunded        — ticket status = refunded
--   wrong_event     — ticket exists but belongs to a different event than p_event_id
--   invalid         — no ticket for token, or status in (void, transfer_pending)
CREATE OR REPLACE FUNCTION public.redeem_ticket(
  p_qr_token   text,
  p_event_id   integer,
  p_scanned_by text,
  p_device_id  text DEFAULT NULL,
  p_offline    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_result text;
  v_checked_in_at timestamptz;
  v_checked_in_by text;
BEGIN
  -- Atomic CAS: only an 'active' ticket for THIS event flips to scanned.
  UPDATE public.tickets
  SET status        = 'scanned',
      checked_in_at = now(),
      checked_in_by = p_scanned_by
  WHERE qr_token = p_qr_token
    AND event_id = p_event_id
    AND status   = 'active'
  RETURNING * INTO v_ticket;

  IF FOUND THEN
    v_result        := 'valid';
    v_checked_in_at := v_ticket.checked_in_at;
    v_checked_in_by := v_ticket.checked_in_by;
  ELSE
    -- CAS lost or no match: report the ticket's actual state.
    SELECT * INTO v_ticket FROM public.tickets WHERE qr_token = p_qr_token;
    IF NOT FOUND THEN
      v_result := 'invalid';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_result := 'wrong_event';
    ELSIF v_ticket.status = 'scanned' THEN
      v_result        := 'already_scanned';
      v_checked_in_at := v_ticket.checked_in_at;  -- original scan time
      v_checked_in_by := v_ticket.checked_in_by;
    ELSIF v_ticket.status = 'refunded' THEN
      v_result := 'refunded';
    ELSE
      -- void, transfer_pending, or any future non-admittable state.
      v_result := 'invalid';
    END IF;
  END IF;

  -- Always audit, whatever the outcome.
  INSERT INTO public.checkins (ticket_id, event_id, scanned_by, device_id, result, offline)
  VALUES (v_ticket.id, p_event_id, p_scanned_by, p_device_id, v_result, coalesce(p_offline, false));

  RETURN jsonb_build_object(
    'result',        v_result,
    'ticketId',      v_ticket.id,
    'ticketStatus',  v_ticket.status,
    'ticketTypeId',  v_ticket.ticket_type_id,
    'eventId',       v_ticket.event_id,
    'checkedInAt',   v_checked_in_at,
    'checkedInBy',   v_checked_in_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_ticket(text, integer, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_ticket(text, integer, text, text, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
