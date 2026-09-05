-- ══════════════════════════════════════════════════════════════
-- Waitlist auto-offer state (WS-2)
-- ══════════════════════════════════════════════════════════════
-- event_waitlist (20260422) already tracks membership + notified_at.
-- Auto-offer needs a real offer lifecycle so a freed seat can be
-- offered to the next entry, expire, and be re-offered down the list:
--   none      → not (or no longer) holding an offer
--   offered   → seat offered; offer_expires_at set; notified_at stamped
--   expired   → offer window lapsed unclaimed (sweep moves offered →
--               expired where offer_expires_at < now(), then offers
--               the next entry)
--   converted → entry purchased/claimed the seat
ALTER TABLE event_waitlist
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_status text NOT NULL DEFAULT 'none';

DO $$ BEGIN
  ALTER TABLE event_waitlist DROP CONSTRAINT IF EXISTS event_waitlist_offer_status_check;
  ALTER TABLE event_waitlist ADD CONSTRAINT event_waitlist_offer_status_check
    CHECK (offer_status IN ('none','offered','expired','converted'));
EXCEPTION WHEN others THEN NULL; END $$;

COMMENT ON COLUMN event_waitlist.offer_status IS
  'Auto-offer lifecycle: none | offered | expired | converted. Writes are service-role only (offer cron / capacity-release hook).';
COMMENT ON COLUMN event_waitlist.offer_expires_at IS
  'Deadline for an offered seat; the expiry sweep flips offered→expired past this and re-offers the next entry.';

-- Expiry sweep + "who currently holds an offer for this tier" lookups.
CREATE INDEX IF NOT EXISTS idx_event_waitlist_offered
  ON event_waitlist(offer_expires_at)
  WHERE offer_status = 'offered';

NOTIFY pgrst, 'reload schema';
