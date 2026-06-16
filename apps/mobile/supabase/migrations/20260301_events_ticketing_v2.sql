-- ============================================================
-- DVNT Events + Ticketing + Organizer + Sneaky Link V2
-- Additive migration — no existing columns dropped or renamed
-- ============================================================

-- ── 1. Extend existing events table with new columns ────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public'
    CHECK (visibility IN ('public','private','link_only')),
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS location_type text DEFAULT 'physical'
    CHECK (location_type IN ('virtual','physical')),
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS location_address text,
  ADD COLUMN IF NOT EXISTS location_lat double precision,
  ADD COLUMN IF NOT EXISTS location_lng double precision,
  ADD COLUMN IF NOT EXISTS vibes_media jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS disclaimers text,
  ADD COLUMN IF NOT EXISTS nsfw boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS age_restriction text DEFAULT 'none'
    CHECK (age_restriction IN ('none','18+','21+')),
  ADD COLUMN IF NOT EXISTS ticketing_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'pending'
    CHECK (payout_status IN ('pending','on_hold','released','disabled')),
  ADD COLUMN IF NOT EXISTS payout_release_at timestamptz,
  ADD COLUMN IF NOT EXISTS share_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ── 2. Event invites (private events) ───────────────────────
CREATE TABLE IF NOT EXISTS event_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  invited_user_id text,
  invited_email text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_invites_event ON event_invites(event_id);
CREATE INDEX IF NOT EXISTS idx_event_invites_user ON event_invites(invited_user_id);

-- ── 3. Ticket types (multi-tier) ────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency text DEFAULT 'usd',
  quantity_total integer,
  quantity_sold integer DEFAULT 0,
  max_per_user integer DEFAULT 4,
  sale_start timestamptz,
  sale_end timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_types_event ON ticket_types(event_id);

-- ── 4. Tickets (purchased, per-user) ────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active','scanned','refunded','void')),
  qr_token text UNIQUE NOT NULL,
  checked_in_at timestamptz,
  checked_in_by text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  purchase_amount_cents integer,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_qr ON tickets(qr_token);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(event_id, status);

-- ── 5. Event financials (materialized snapshot) ─────────────
CREATE TABLE IF NOT EXISTS event_financials (
  event_id integer PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  gross_cents integer DEFAULT 0,
  refunds_cents integer DEFAULT 0,
  dvnt_fee_cents integer DEFAULT 0,
  stripe_fee_cents integer DEFAULT 0,
  net_cents integer DEFAULT 0,
  calculated_at timestamptz
);

-- ── 6. Organizer accounts (Stripe Connect) ──────────────────
CREATE TABLE IF NOT EXISTS organizer_accounts (
  host_id text PRIMARY KEY,
  stripe_account_id text UNIQUE,
  charges_enabled boolean DEFAULT false,
  payouts_enabled boolean DEFAULT false,
  details_submitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── 7. Payouts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  host_id text NOT NULL,
  stripe_payout_id text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','on_hold')),
  gross_cents integer,
  net_cents integer,
  release_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payouts_event ON payouts(event_id);
CREATE INDEX IF NOT EXISTS idx_payouts_host ON payouts(host_id);

-- ── 8. Event reports (moderation) ───────────────────────────
CREATE TABLE IF NOT EXISTS reports_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_id text NOT NULL,
  reason text,
  details text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_events_event ON reports_events(event_id);

-- ── 9. Stripe webhook idempotency ───────────────────────────
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz DEFAULT now()
);

-- ── 10. Sneaky Link access (paywall) ────────────────────────
-- Add columns to video_rooms if that's the sneaky link table
-- If video_rooms doesn't exist, create sneaky_access standalone
DO $$
BEGIN
  -- Add sweet/spicy + nsa columns to video_rooms if the table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_rooms') THEN
    ALTER TABLE video_rooms
      ADD COLUMN IF NOT EXISTS sweet_spicy_mode text DEFAULT 'sweet'
        CHECK (sweet_spicy_mode IN ('sweet','spicy')),
      ADD COLUMN IF NOT EXISTS nsa_enabled boolean DEFAULT false;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sneaky_access (
  session_id text NOT NULL,
  user_id text NOT NULL,
  amount_cents integer DEFAULT 299,
  currency text DEFAULT 'usd',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (session_id, user_id)
);

-- ── 11. Decellus ad config (scaffold) ───────────────────────
CREATE TABLE IF NOT EXISTS ads_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key text UNIQUE NOT NULL,
  title text,
  image_url text,
  tap_url text,
  active boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ── 12. Grants for authenticated role ───────────────────────
-- ticket_types: read by anyone, write by host (RLS enforced)
GRANT SELECT ON ticket_types TO authenticated;
GRANT INSERT, UPDATE ON ticket_types TO authenticated;

-- tickets: read own + host reads all for their event (RLS enforced)
GRANT SELECT, INSERT, UPDATE ON tickets TO authenticated;

-- event_invites
GRANT SELECT, INSERT, UPDATE ON event_invites TO authenticated;

-- event_financials: read only
GRANT SELECT ON event_financials TO authenticated;

-- organizer_accounts: read/write own
GRANT SELECT, INSERT, UPDATE ON organizer_accounts TO authenticated;

-- payouts: read only
GRANT SELECT ON payouts TO authenticated;

-- reports_events: insert only
GRANT INSERT ON reports_events TO authenticated;

-- sneaky_access: read own
GRANT SELECT ON sneaky_access TO authenticated;

-- ads_config: read only
GRANT SELECT ON ads_config TO authenticated;

-- stripe_events: service role only (no grant to authenticated)

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- ── ticket_types ────────────────────────────────────────────
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_types_select"
  ON ticket_types FOR SELECT
  USING (true);

CREATE POLICY "ticket_types_insert"
  ON ticket_types FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_types.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "ticket_types_update"
  ON ticket_types FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_types.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- ── tickets ─────────────────────────────────────────────────
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_select_own"
  ON tickets FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tickets.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "tickets_update_host"
  ON tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tickets.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- ── event_invites ───────────────────────────────────────────
ALTER TABLE event_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_invites_select"
  ON event_invites FOR SELECT
  USING (
    invited_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_invites.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

CREATE POLICY "event_invites_insert"
  ON event_invites FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_invites.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- ── organizer_accounts ──────────────────────────────────────
ALTER TABLE organizer_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizer_accounts_own"
  ON organizer_accounts FOR ALL
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ── payouts ─────────────────────────────────────────────────
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payouts_select_own"
  ON payouts FOR SELECT
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ── reports_events ──────────────────────────────────────────
ALTER TABLE reports_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_events_insert"
  ON reports_events FOR INSERT
  WITH CHECK (reporter_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ── sneaky_access ───────────────────────────────────────────
ALTER TABLE sneaky_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sneaky_access_select_own"
  ON sneaky_access FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ── ads_config ──────────────────────────────────────────────
ALTER TABLE ads_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ads_config_select"
  ON ads_config FOR SELECT
  USING (active = true);
