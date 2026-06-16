-- ══════════════════════════════════════════════════════════════
-- Capacity alert tracking on ticket_types
-- ══════════════════════════════════════════════════════════════
-- Records the highest % sold threshold each tier has hit, so we can
-- fire a notification to the event organizer EXACTLY ONCE as the
-- tier crosses 75 / 90 / 100 % sold. Starts at 0 for existing rows.
--
-- Updated by the capacity-alerts shared helper inside the webhook
-- and free-ticket paths; reset to 0 is fine if the tier's
-- quantity_total grows (new inventory released).

ALTER TABLE ticket_types
  ADD COLUMN IF NOT EXISTS capacity_alert_level integer NOT NULL DEFAULT 0;

-- Keep service role in sync so edge functions can update it.
GRANT ALL ON ticket_types TO service_role;

NOTIFY pgrst, 'reload schema';
