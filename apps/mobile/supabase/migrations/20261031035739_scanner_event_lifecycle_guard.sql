-- Reject cancellation/deletion at the atomic admission boundary, including
-- the interval before asynchronous refunds/voiding finish. No ticket rows are
-- modified by applying this migration. Preserve existing service-only ACLs.
-- Lock the credential before the event to match ticket mutation/attendance
-- triggers. Event NOWAIT avoids deadlock against legacy event-first issuers;
-- contention returns retry_later, never a false admission or permanent denial.
BEGIN;

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
  v_event_status text;
  v_ticket public.tickets%ROWTYPE;
  v_result text;
  v_checked_in_at timestamptz;
  v_checked_in_by text;
BEGIN
  -- Unknown/wrong-event credentials retain their original result contract.
  SELECT * INTO v_ticket FROM public.tickets WHERE qr_token=p_qr_token FOR UPDATE;
  IF FOUND AND v_ticket.event_id=p_event_id THEN
    BEGIN
      SELECT status INTO v_event_status FROM public.events
        WHERE id=p_event_id FOR NO KEY UPDATE NOWAIT;
      IF NOT FOUND THEN RETURN jsonb_build_object('result','event_not_found'); END IF;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('result','retry_later');
    END;
    IF lower(coalesce(v_event_status,'')) IN ('cancelled','canceled','deleted') THEN
      INSERT INTO public.checkins(ticket_id,event_id,scanned_by,device_id,result,offline) VALUES(v_ticket.id,p_event_id,p_scanned_by,p_device_id,'invalid',coalesce(p_offline,false));
      RETURN jsonb_build_object('result','event_cancelled','eventId',p_event_id);
    END IF;
    -- UPDATE statement triggers upsert this row. Prelock it without waiting:
    -- legacy issuers take financials via an order INSERT before event attendance.
    -- Never create a missing summary here (accounting is outside scan authority).
    BEGIN
      PERFORM 1 FROM public.event_financials WHERE event_id=p_event_id
        FOR NO KEY UPDATE NOWAIT;
      IF NOT FOUND THEN RETURN jsonb_build_object('result','financials_unavailable'); END IF;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('result','retry_later');
    END;
  END IF;
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


CREATE OR REPLACE FUNCTION public.redeem_addon(
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
  v_event_status text;
  v_row public.order_addons%ROWTYPE;
  v_result text;
  v_redeemed_at timestamptz;
  v_redeemed_by text;
  v_addon_name text;
  v_variant_name text;
BEGIN
  -- Unknown/wrong-event credentials retain their original result contract.
  SELECT * INTO v_row FROM public.order_addons WHERE qr_token=p_qr_token FOR UPDATE;
  IF FOUND AND v_row.event_id=p_event_id THEN
    BEGIN
      SELECT status INTO v_event_status FROM public.events
        WHERE id=p_event_id FOR NO KEY UPDATE NOWAIT;
      IF NOT FOUND THEN RETURN jsonb_build_object('result','event_not_found'); END IF;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('result','retry_later');
    END;
    IF lower(coalesce(v_event_status,'')) IN ('cancelled','canceled','deleted') THEN
      INSERT INTO public.checkins(ticket_id,order_addon_id,event_id,scanned_by,device_id,result,offline) VALUES(v_row.ticket_id,v_row.id,p_event_id,p_scanned_by,p_device_id,'invalid',coalesce(p_offline,false));
      RETURN jsonb_build_object('result','event_cancelled','eventId',p_event_id);
    END IF;
    -- UPDATE statement triggers upsert this row. Prelock it without waiting:
    -- legacy issuers take financials via an order INSERT before event attendance.
    -- Never create a missing summary here (accounting is outside scan authority).
    BEGIN
      PERFORM 1 FROM public.event_financials WHERE event_id=p_event_id
        FOR NO KEY UPDATE NOWAIT;
      IF NOT FOUND THEN RETURN jsonb_build_object('result','financials_unavailable'); END IF;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('result','retry_later');
    END;
  END IF;
  -- Atomic CAS: only an admittable add-on for THIS event flips to redeemed.
  UPDATE public.order_addons
  SET status      = 'redeemed',
      redeemed_at = now(),
      redeemed_by = p_scanned_by
  WHERE qr_token = p_qr_token
    AND event_id = p_event_id
    AND status IN ('unfulfilled','fulfilled')
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_result      := 'valid';
    v_redeemed_at := v_row.redeemed_at;
    v_redeemed_by := v_row.redeemed_by;
  ELSE
    -- CAS lost or no match: report the add-on's actual state.
    SELECT * INTO v_row FROM public.order_addons WHERE qr_token = p_qr_token;
    IF NOT FOUND THEN
      v_result := 'invalid';
    ELSIF v_row.event_id <> p_event_id THEN
      v_result := 'wrong_event';
    ELSIF v_row.status = 'redeemed' THEN
      v_result      := 'already_scanned';
      v_redeemed_at := v_row.redeemed_at;  -- original redemption time
      v_redeemed_by := v_row.redeemed_by;
    ELSIF v_row.status = 'refunded' THEN
      v_result := 'refunded';
    ELSE
      v_result := 'invalid';
    END IF;
  END IF;

  -- Display names for the door result card (one round trip).
  IF v_row.addon_id IS NOT NULL THEN
    SELECT a.name INTO v_addon_name
    FROM public.ticket_addons a WHERE a.id = v_row.addon_id;
  END IF;
  IF v_row.variant_id IS NOT NULL THEN
    SELECT v.name INTO v_variant_name
    FROM public.ticket_addon_variants v WHERE v.id = v_row.variant_id;
  END IF;

  -- Always audit, whatever the outcome.
  INSERT INTO public.checkins
    (ticket_id, order_addon_id, event_id, scanned_by, device_id, result, offline)
  VALUES
    (v_row.ticket_id, v_row.id, p_event_id, p_scanned_by, p_device_id,
     v_result, coalesce(p_offline, false));

  RETURN jsonb_build_object(
    'result',       v_result,
    'orderAddonId', v_row.id,
    'addonId',      v_row.addon_id,
    'addonName',    v_addon_name,
    'variantName',  v_variant_name,
    'quantity',     v_row.quantity,
    'status',       v_row.status,
    'ticketId',     v_row.ticket_id,
    'eventId',      v_row.event_id,
    'redeemedAt',   v_redeemed_at,
    'redeemedBy',   v_redeemed_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_addon(text, integer, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_addon(text, integer, text, text, boolean) TO service_role;


COMMIT;
NOTIFY pgrst, 'reload schema';
