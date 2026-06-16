-- ============================================================
-- DVNT Ticketing V3 — Inventory Holds, Checkins, Co-organizers
-- Non-breaking additive migration. No columns dropped.
-- ============================================================

-- ── 1. Ticket holds (inventory reservation with TTL) ────────
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

-- ── 2. Checkins audit table (scan events) ───────────────────
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

-- ── 3. Co-organizers table ──────────────────────────────────
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

-- ── 4. Audit log (sensitive changes) ────────────────────────
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

-- ── 5. Add HMAC signature column to tickets ─────────────────
-- Non-breaking: new nullable column, existing tickets keep working
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tickets' AND column_name = 'qr_payload'
  ) THEN
    ALTER TABLE tickets ADD COLUMN qr_payload text;
  END IF;
END $$;

-- ── Grants (service_role) ───────────────────────────────────
GRANT ALL ON public.ticket_holds TO service_role;
GRANT ALL ON public.checkins TO service_role;
GRANT ALL ON public.event_co_organizers TO service_role;
GRANT ALL ON public.audit_log TO service_role;

-- Authenticated users: read-only where appropriate
GRANT SELECT ON ticket_holds TO authenticated;
GRANT SELECT ON checkins TO authenticated;
GRANT SELECT ON event_co_organizers TO authenticated;
-- audit_log: no direct authenticated access (service_role only)

-- ── RLS (deny-by-default) ───────────────────────────────────
ALTER TABLE ticket_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket_holds_own" ON ticket_holds FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkins_select_event_host" ON checkins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = checkins.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

ALTER TABLE event_co_organizers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coorg_select_involved" ON event_co_organizers FOR SELECT
  USING (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_co_organizers.event_id
        AND e.host_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
-- No authenticated policies on audit_log — service_role only
