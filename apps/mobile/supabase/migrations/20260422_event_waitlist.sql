-- ══════════════════════════════════════════════════════════════
-- Event waitlist
-- ══════════════════════════════════════════════════════════════
-- A user (or a future guest) can join the waitlist for a specific
-- ticket tier when it's sold out. One row per user-per-tier (or
-- email-per-tier). Designed so a future cron / webhook can mark
-- `notified_at` and DM the user when an upgrade or transfer frees
-- up inventory.

CREATE TABLE IF NOT EXISTS event_waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id  uuid REFERENCES ticket_types(id) ON DELETE SET NULL,
  user_id         text,
  guest_email     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz,
  CONSTRAINT event_waitlist_user_or_email
    CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_event_waitlist_event
  ON event_waitlist(event_id);
CREATE INDEX IF NOT EXISTS idx_event_waitlist_user
  ON event_waitlist(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_waitlist_email
  ON event_waitlist(guest_email) WHERE guest_email IS NOT NULL;

-- Prevent the same user (or guest email) from joining the same
-- (event, tier) more than once.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_waitlist_user
  ON event_waitlist(event_id, COALESCE(ticket_type_id::text, ''), user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_waitlist_email
  ON event_waitlist(event_id, COALESCE(ticket_type_id::text, ''), guest_email)
  WHERE guest_email IS NOT NULL;

ALTER TABLE event_waitlist ENABLE ROW LEVEL SECURITY;

-- Read: only the user themself OR the event host. Writes go through
-- the privileged edge function (service role bypasses RLS).
DROP POLICY IF EXISTS "event_waitlist_select" ON event_waitlist;
CREATE POLICY "event_waitlist_select" ON event_waitlist FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_waitlist.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

GRANT SELECT ON event_waitlist TO authenticated;
GRANT ALL    ON event_waitlist TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

NOTIFY pgrst, 'reload schema';
