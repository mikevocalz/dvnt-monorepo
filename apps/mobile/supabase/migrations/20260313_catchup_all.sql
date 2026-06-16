-- ============================================================
-- CATCH-UP: Re-apply all DDL from 20260301 (failed silently)
-- + merge 20260312 ticketing v3 tables
-- All guards are idempotent (IF NOT EXISTS / EXCEPTION handlers)
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- PART A: Missing events columns from 20260301
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public';
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_type text DEFAULT 'physical';
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_name text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_address text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lat double precision;
ALTER TABLE events ADD COLUMN IF NOT EXISTS location_lng double precision;
ALTER TABLE events ADD COLUMN IF NOT EXISTS vibes_media jsonb DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS disclaimers text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS nsfw boolean DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS age_restriction text DEFAULT 'none';
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticketing_enabled boolean DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS payout_status text DEFAULT 'pending';
ALTER TABLE events ADD COLUMN IF NOT EXISTS payout_release_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS share_slug text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Named CHECK constraints (skip if already exist)
DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_visibility_check
    CHECK (visibility IN ('public','private','link_only'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_location_type_check
    CHECK (location_type IN ('virtual','physical'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_age_restriction_check
    CHECK (age_restriction IN ('none','18+','21+'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_payout_status_check
    CHECK (payout_status IN ('pending','on_hold','released','disabled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_share_slug
  ON events(share_slug) WHERE share_slug IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- PART B: Missing tables from 20260301
-- ═══════════════════════════════════════════════════════════════

-- ── Event invites ─────────────────────────────────────────────
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

-- ── Ticket types ──────────────────────────────────────────────
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

-- ── Tickets ───────────────────────────────────────────────────
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

-- ── Event financials ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_financials (
  event_id integer PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  gross_cents integer DEFAULT 0,
  refunds_cents integer DEFAULT 0,
  dvnt_fee_cents integer DEFAULT 0,
  stripe_fee_cents integer DEFAULT 0,
  net_cents integer DEFAULT 0,
  calculated_at timestamptz
);

-- ── Organizer accounts ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizer_accounts (
  host_id text PRIMARY KEY,
  stripe_account_id text UNIQUE,
  charges_enabled boolean DEFAULT false,
  payouts_enabled boolean DEFAULT false,
  details_submitted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Payouts ───────────────────────────────────────────────────
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

-- ── Event reports ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_id text NOT NULL,
  reason text,
  details text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_events_event ON reports_events(event_id);

-- ── Stripe events (idempotency) ──────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz DEFAULT now()
);

-- ── Sneaky Link access ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_rooms') THEN
    ALTER TABLE video_rooms
      ADD COLUMN IF NOT EXISTS sweet_spicy_mode text DEFAULT 'sweet',
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

-- ── Ads config ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ads_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_key text UNIQUE NOT NULL,
  title text,
  image_url text,
  tap_url text,
  active boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- PART C: Tables from 20260312 (ticketing v3)
-- ═══════════════════════════════════════════════════════════════

-- ── Ticket holds (inventory reservation with TTL) ─────────────
CREATE TABLE IF NOT EXISTS ticket_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  ticket_type_id uuid NOT NULL,
  event_id integer NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  payment_intent_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_holds_type_status ON ticket_holds(ticket_type_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_holds_pi ON ticket_holds(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_ticket_holds_expires ON ticket_holds(expires_at) WHERE status = 'active';

-- ── Checkins audit table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  event_id integer NOT NULL,
  scanned_by text,
  device_id text,
  result text NOT NULL CHECK (result IN ('valid', 'already_scanned', 'invalid', 'refunded', 'wrong_event')),
  offline boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checkins_ticket ON checkins(ticket_id);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON checkins(event_id);
CREATE INDEX IF NOT EXISTS idx_checkins_event_time ON checkins(event_id, created_at);

-- ── Co-organizers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_co_organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'scanner', 'editor', 'admin')),
  invited_by text,
  accepted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coorg_event_user ON event_co_organizers(event_id, user_id);
CREATE INDEX IF NOT EXISTS idx_coorg_user ON event_co_organizers(user_id);

-- ── Audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  detail jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log(created_at);

-- ── HMAC qr_payload column on tickets ─────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tickets')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'qr_payload')
  THEN
    ALTER TABLE tickets ADD COLUMN qr_payload text;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- PART D: Grants
-- ═══════════════════════════════════════════════════════════════

-- 20260301 tables — authenticated
GRANT SELECT ON ticket_types TO authenticated;
GRANT INSERT, UPDATE ON ticket_types TO authenticated;
GRANT SELECT, INSERT, UPDATE ON tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE ON event_invites TO authenticated;
GRANT SELECT ON event_financials TO authenticated;
GRANT SELECT, INSERT, UPDATE ON organizer_accounts TO authenticated;
GRANT SELECT ON payouts TO authenticated;
GRANT INSERT ON reports_events TO authenticated;
GRANT SELECT ON sneaky_access TO authenticated;
GRANT SELECT ON ads_config TO authenticated;

-- 20260312 tables — authenticated
GRANT SELECT ON ticket_holds TO authenticated;
GRANT SELECT ON checkins TO authenticated;
GRANT SELECT ON event_co_organizers TO authenticated;

-- Service role — all tables
GRANT ALL ON ticket_types TO service_role;
GRANT ALL ON tickets TO service_role;
GRANT ALL ON event_invites TO service_role;
GRANT ALL ON event_financials TO service_role;
GRANT ALL ON organizer_accounts TO service_role;
GRANT ALL ON payouts TO service_role;
GRANT ALL ON reports_events TO service_role;
GRANT ALL ON stripe_events TO service_role;
GRANT ALL ON sneaky_access TO service_role;
GRANT ALL ON ads_config TO service_role;
GRANT ALL ON ticket_holds TO service_role;
GRANT ALL ON checkins TO service_role;
GRANT ALL ON event_co_organizers TO service_role;
GRANT ALL ON audit_log TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- PART E: RLS policies
-- ═══════════════════════════════════════════════════════════════

-- ticket_types
ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_types_select" ON ticket_types;
CREATE POLICY "ticket_types_select"
  ON ticket_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "ticket_types_insert" ON ticket_types;
CREATE POLICY "ticket_types_insert"
  ON ticket_types FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_types.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

DROP POLICY IF EXISTS "ticket_types_update" ON ticket_types;
CREATE POLICY "ticket_types_update"
  ON ticket_types FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = ticket_types.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- tickets
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tickets_select_own" ON tickets;
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

DROP POLICY IF EXISTS "tickets_update_host" ON tickets;
CREATE POLICY "tickets_update_host"
  ON tickets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = tickets.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- event_invites
ALTER TABLE event_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_invites_select" ON event_invites;
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

DROP POLICY IF EXISTS "event_invites_insert" ON event_invites;
CREATE POLICY "event_invites_insert"
  ON event_invites FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_invites.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- organizer_accounts
ALTER TABLE organizer_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizer_accounts_own" ON organizer_accounts;
CREATE POLICY "organizer_accounts_own"
  ON organizer_accounts FOR ALL
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- payouts
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payouts_select_own" ON payouts;
CREATE POLICY "payouts_select_own"
  ON payouts FOR SELECT
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- reports_events
ALTER TABLE reports_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_events_insert" ON reports_events;
CREATE POLICY "reports_events_insert"
  ON reports_events FOR INSERT
  WITH CHECK (reporter_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- sneaky_access
ALTER TABLE sneaky_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sneaky_access_select_own" ON sneaky_access;
CREATE POLICY "sneaky_access_select_own"
  ON sneaky_access FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ads_config
ALTER TABLE ads_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ads_config_select" ON ads_config;
CREATE POLICY "ads_config_select"
  ON ads_config FOR SELECT
  USING (active = true);

-- ticket_holds
ALTER TABLE ticket_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ticket_holds_own" ON ticket_holds;
CREATE POLICY "ticket_holds_own" ON ticket_holds FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- checkins
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkins_select_event_host" ON checkins;
CREATE POLICY "checkins_select_event_host" ON checkins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = checkins.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- event_co_organizers
ALTER TABLE event_co_organizers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coorg_select_involved" ON event_co_organizers;
CREATE POLICY "coorg_select_involved" ON event_co_organizers FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_co_organizers.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

-- audit_log (service_role only — no authenticated policies)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- PART F: Notify PostgREST to reload schema cache
-- ═══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
