-- ============================================================================
-- Migration: Event Spotlight Campaigns  (HARDENED — Option A compliant)
--
-- Description : Adds paid promotion / spotlight system for events
-- Architecture: Option A — Service-Role Gateway
--               • Table is deny-by-default for anon/authenticated
--               • All writes go through Edge Functions (service_role)
--               • Controlled reads via SECURITY DEFINER RPCs only
--
-- Safety      : Idempotent (IF NOT EXISTS / IF EXISTS / DO $$ guards)
--               No destructive changes (expand-only phase)
--               FK to cities is DEFERRED to tolerate migration ordering
-- ============================================================================

-- ── Phase 1: EXPAND — additive schema changes ─────────────────────────────

-- 1a. Flyer columns on events (nullable, no backfill needed)
ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_image_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS flyer_image_meta jsonb;

COMMENT ON COLUMN events.flyer_image_url IS 'Optional 3:5 flyer image URL used by Spotlight carousel';
COMMENT ON COLUMN events.flyer_image_meta IS 'Flyer metadata: {width, height, aspectRatio, blurhash}';

-- 1b. Campaigns table
--     city_id FK is NULLABLE and has NO FK constraint here because the cities
--     table may not exist yet (created in 20260303). A deferred ALTER TABLE
--     at the bottom adds the FK once cities exists (safe if cities is absent).
CREATE TABLE IF NOT EXISTS event_spotlight_campaigns (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  city_id         bigint,                   -- FK added later (Phase 1d)
  organizer_id    text NOT NULL,            -- Better Auth user.id

  -- Campaign configuration
  placement       text NOT NULL DEFAULT 'spotlight+feed'
    CHECK (placement IN ('spotlight', 'feed', 'spotlight+feed')),
  priority        int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'expired', 'cancelled')),

  -- Time window
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  CONSTRAINT ends_after_starts CHECK (ends_at > starts_at),

  -- Payment linkage
  stripe_payment_intent_id text,
  receipt_id       bigint,
  amount_cents     int NOT NULL DEFAULT 0,
  currency         text NOT NULL DEFAULT 'usd',

  -- Metadata
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_spotlight_campaigns IS 'Paid promotion campaigns — deny-by-default for client roles (Option A)';

-- 1c. Indexes (all IF NOT EXISTS — safe to re-run)
CREATE INDEX IF NOT EXISTS idx_spotlight_active_city
  ON event_spotlight_campaigns (city_id, placement, status, starts_at, ends_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_spotlight_by_event
  ON event_spotlight_campaigns (event_id, status);

CREATE INDEX IF NOT EXISTS idx_spotlight_by_organizer
  ON event_spotlight_campaigns (organizer_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spotlight_stripe_pi
  ON event_spotlight_campaigns (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- 1d. Deferred FK to cities — only added if cities table already exists.
--     If cities doesn't exist yet (20260303 hasn't run), this is a no-op
--     and 20260303 should add the FK after creating cities.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cities'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_spotlight_city'
        AND table_name = 'event_spotlight_campaigns'
    ) THEN
      ALTER TABLE event_spotlight_campaigns
        ADD CONSTRAINT fk_spotlight_city
        FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;


-- ── Phase 2: HARDEN — Option A RLS (deny-by-default) ──────────────────────

ALTER TABLE event_spotlight_campaigns ENABLE ROW LEVEL SECURITY;

-- 2a. Revoke default schema-level grants from client roles.
--     Supabase auto-grants ALL via ALTER DEFAULT PRIVILEGES; revoke them.
REVOKE ALL ON event_spotlight_campaigns FROM anon, authenticated;

-- 2b. Explicit deny policies for anon (defense-in-depth + self-documenting)
DROP POLICY IF EXISTS "deny_anon_select" ON event_spotlight_campaigns;
CREATE POLICY "deny_anon_select" ON event_spotlight_campaigns
  FOR SELECT TO anon USING (false);

DROP POLICY IF EXISTS "deny_anon_insert" ON event_spotlight_campaigns;
CREATE POLICY "deny_anon_insert" ON event_spotlight_campaigns
  FOR INSERT TO anon WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_update" ON event_spotlight_campaigns;
CREATE POLICY "deny_anon_update" ON event_spotlight_campaigns
  FOR UPDATE TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_delete" ON event_spotlight_campaigns;
CREATE POLICY "deny_anon_delete" ON event_spotlight_campaigns
  FOR DELETE TO anon USING (false);

-- 2c. Explicit deny policies for authenticated
DROP POLICY IF EXISTS "deny_auth_select" ON event_spotlight_campaigns;
CREATE POLICY "deny_auth_select" ON event_spotlight_campaigns
  FOR SELECT TO authenticated USING (false);

DROP POLICY IF EXISTS "deny_auth_insert" ON event_spotlight_campaigns;
CREATE POLICY "deny_auth_insert" ON event_spotlight_campaigns
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "deny_auth_update" ON event_spotlight_campaigns;
CREATE POLICY "deny_auth_update" ON event_spotlight_campaigns
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_auth_delete" ON event_spotlight_campaigns;
CREATE POLICY "deny_auth_delete" ON event_spotlight_campaigns
  FOR DELETE TO authenticated USING (false);

-- 2d. Remove old permissive policies if they exist (from pre-hardening)
DROP POLICY IF EXISTS spotlight_select_active ON event_spotlight_campaigns;
DROP POLICY IF EXISTS spotlight_select_own ON event_spotlight_campaigns;
DROP POLICY IF EXISTS spotlight_insert_own ON event_spotlight_campaigns;
DROP POLICY IF EXISTS spotlight_update_own ON event_spotlight_campaigns;
DROP POLICY IF EXISTS spotlight_delete_own ON event_spotlight_campaigns;

-- 2e. Ensure service_role has full access (it already bypasses RLS, but
--     we need table-level GRANT since we revoked ALL above).
GRANT ALL ON event_spotlight_campaigns TO service_role;
GRANT USAGE ON SEQUENCE event_spotlight_campaigns_id_seq TO service_role;


-- ── Phase 3: TRIGGERS ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_spotlight_campaign_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spotlight_campaign_updated ON event_spotlight_campaigns;
CREATE TRIGGER trg_spotlight_campaign_updated
  BEFORE UPDATE ON event_spotlight_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_spotlight_campaign_timestamp();


-- ── Phase 4: FUNCTIONS (SECURITY DEFINER — controlled read gateway) ───────
--
-- All RPCs are SECURITY DEFINER so they run as the function owner (postgres)
-- which bypasses RLS. This is the *intended* read path for client roles.
-- Client roles CANNOT touch the table directly (denied above).
-- Edge functions use service_role (bypasses RLS + grants).

-- 4a. Spotlight feed — PUBLIC data (active campaigns visible to everyone)
CREATE OR REPLACE FUNCTION get_spotlight_feed(p_city_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      c.id AS campaign_id,
      c.event_id,
      c.placement,
      c.priority,
      c.starts_at,
      c.ends_at,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.location,
      e.price,
      e.category,
      e.total_attendees,
      COALESCE(e.flyer_image_url, e.cover_image_url, e.image) AS spotlight_image,
      COALESCE(e.cover_image_url, e.image) AS cover_image,
      e.host_id,
      u.username AS host_username,
      av.url AS host_avatar
    FROM event_spotlight_campaigns c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN users u ON u.auth_id = c.organizer_id
    LEFT JOIN media av ON av.id = u.avatar_id
    WHERE c.status = 'active'
      AND now() BETWEEN c.starts_at AND c.ends_at
      AND c.placement IN ('spotlight', 'spotlight+feed')
      AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
    ORDER BY c.priority DESC, c.ends_at ASC, e.total_attendees DESC
    LIMIT 8
  ) t;
$$;

-- 4b. Promoted event IDs — PUBLIC data (used by feed to flag is_promoted)
CREATE OR REPLACE FUNCTION get_promoted_event_ids(p_city_id bigint DEFAULT NULL)
RETURNS TABLE(event_id bigint, campaign_priority int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.event_id)
    c.event_id,
    c.priority AS campaign_priority
  FROM event_spotlight_campaigns c
  WHERE c.status = 'active'
    AND now() BETWEEN c.starts_at AND c.ends_at
    AND c.placement IN ('feed', 'spotlight+feed')
    AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
  ORDER BY c.event_id, c.priority DESC;
$$;

-- 4c. Organizer campaign lookup — PRIVATE data, caller must own campaigns.
--     JWT sub is verified inside the function; mismatches return empty [].
CREATE OR REPLACE FUNCTION get_event_campaigns(p_event_id bigint, p_organizer_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_auth_id text;
BEGIN
  -- Verify the JWT caller IS the requested organizer
  caller_auth_id := current_setting('request.jwt.claims', true)::json->>'sub';
  IF caller_auth_id IS NULL OR caller_auth_id != p_organizer_id THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(row_to_json(c) ORDER BY c.created_at DESC),
      '[]'::jsonb
    )
    FROM event_spotlight_campaigns c
    WHERE c.event_id = p_event_id
      AND c.organizer_id = p_organizer_id
  );
END;
$$;

-- 4d. Cron expiry helper — runs as postgres via pg_cron
CREATE OR REPLACE FUNCTION expire_spotlight_campaigns()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE event_spotlight_campaigns
  SET status = 'expired', updated_at = now()
  WHERE status = 'active'
    AND ends_at < now();
$$;


-- ── Phase 5: GRANTS — function EXECUTE only (no table grants to clients) ──

-- Client roles get EXECUTE on read RPCs only. No table access.
GRANT EXECUTE ON FUNCTION get_spotlight_feed TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_promoted_event_ids TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_event_campaigns TO authenticated;
GRANT EXECUTE ON FUNCTION expire_spotlight_campaigns TO postgres;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION GATES (run after apply — all must pass)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Gate A: Schema invariants
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'event_spotlight_campaigns'
--   ORDER BY ordinal_position;
--   -- Expect: 14 columns, all types match above
--
-- Gate B: RLS is enabled
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'event_spotlight_campaigns';
--   -- Expect: relrowsecurity = true
--
-- Gate C: Deny policies exist for anon + authenticated
--   SELECT policyname, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE tablename = 'event_spotlight_campaigns';
--   -- Expect: 8 deny policies (4 anon + 4 authenticated), no permissive
--
-- Gate D: Client role cannot read table directly
--   SET ROLE authenticated;
--   SELECT count(*) FROM event_spotlight_campaigns;
--   -- Expect: ERROR or 0 rows
--   RESET ROLE;
--
-- Gate E: RPCs work (SECURITY DEFINER bypasses RLS)
--   SET ROLE authenticated;
--   SELECT get_spotlight_feed(NULL);
--   SELECT * FROM get_promoted_event_ids(NULL);
--   -- Expect: '[]' / 0 rows (no data yet, but no error)
--   RESET ROLE;
--
-- Gate F: No table grants for client roles
--   SELECT grantee, privilege_type
--   FROM information_schema.table_privileges
--   WHERE table_name = 'event_spotlight_campaigns'
--     AND grantee IN ('anon', 'authenticated');
--   -- Expect: 0 rows
-- ════════════════════════════════════════════════════════════════════════════
