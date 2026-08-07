-- ══════════════════════════════════════════════════════════════
-- Door add-on redemption CAS (WS-3 × WS-8) — atomic add-on scans
-- ══════════════════════════════════════════════════════════════
-- order_addons rows carry their own qr_token / redeemed_at
-- (20260613000100) but had no atomic redemption path. redeem_addon
-- mirrors redeem_ticket (20260806100200): the compare-and-swap
-- `UPDATE ... WHERE status IN ('unfulfilled','fulfilled')` means two
-- simultaneous scans of the same add-on QR can never both succeed —
-- the loser sees zero rows and gets the row's actual state back.
-- Every call writes a `checkins` audit row (checkins is write-only
-- today; live door counts read tickets.status, so add-on audit rows
-- cannot skew check-in counts).

-- Door scans look add-ons up by token — index it (tokens exist only
-- on redeemable add-ons, hence the partial index).
CREATE INDEX IF NOT EXISTS idx_order_addons_qr_token
  ON public.order_addons(qr_token) WHERE qr_token IS NOT NULL;

-- Who redeemed it (mirrors tickets.checked_in_by).
ALTER TABLE public.order_addons ADD COLUMN IF NOT EXISTS redeemed_by text;
COMMENT ON COLUMN public.order_addons.redeemed_by IS
  'Verified session user that redeemed this add-on at the door.';

-- Audit rows for add-on scans reference the order_addons row.
-- ticket_id stays populated for per_ticket-bound add-ons.
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS order_addon_id uuid
  REFERENCES public.order_addons(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.checkins.order_addon_id IS
  'Set when the scan redeemed (or tried to redeem) an add-on QR; NULL for ticket scans.';

-- Result mapping (checkins.result CHECK values, 20260313):
--   valid           — CAS won: unfulfilled/fulfilled → redeemed, redeemed_at/by stamped
--   already_scanned — add-on already redeemed; returns ORIGINAL redeemed_at/by
--   refunded        — add-on status = refunded
--   wrong_event     — add-on exists but belongs to a different event than p_event_id
--   invalid         — no add-on for token (callers pre-route, so this is rare)
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
  v_row public.order_addons%ROWTYPE;
  v_result text;
  v_redeemed_at timestamptz;
  v_redeemed_by text;
  v_addon_name text;
  v_variant_name text;
BEGIN
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

NOTIFY pgrst, 'reload schema';
