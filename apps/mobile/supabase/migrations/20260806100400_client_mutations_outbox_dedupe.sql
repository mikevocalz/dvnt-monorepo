-- ══════════════════════════════════════════════════════════════
-- Client-mutation dedupe table (WS-12 outbox)
-- ══════════════════════════════════════════════════════════════
-- Modeled on stripe_events (one row per already-processed id =
-- idempotent replay), extended with the stored result so a replay
-- can answer without re-executing.
--
-- REPLAY CONTRACT (server side, edge functions):
--   1. On receiving a mutation with an Idempotency-Key, INSERT the
--      key here (ON CONFLICT DO NOTHING) BEFORE executing.
--   2. If the insert lands → execute the mutation, then write the
--      response into `result`.
--   3. If the key already exists → return the stored `result`
--      verbatim and DO NOT re-execute. A replayed key must never
--      cause a second write, whatever the mutation was.
--   Keys are client-minted UUIDs, one per outbox entry (extends the
--   cart.ts precedent). user_id is recorded so a replay under a
--   DIFFERENT user can be rejected instead of leaking the original
--   caller's result.
CREATE TABLE IF NOT EXISTS client_mutations (
  idempotency_key text PRIMARY KEY,
  user_id         text NOT NULL,
  mutation_type   text NOT NULL,
  entity_type     text,
  entity_id       text,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_mutations_user
  ON client_mutations(user_id, created_at DESC);
-- For age-based pruning (rows only need to outlive plausible replay windows).
CREATE INDEX IF NOT EXISTS idx_client_mutations_created
  ON client_mutations(created_at);

-- Service-role only: RLS enabled with NO policies = anon/authenticated
-- are denied by construction; only edge functions (service role,
-- bypasses RLS) touch this table.
ALTER TABLE client_mutations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON client_mutations FROM anon;
REVOKE ALL ON client_mutations FROM authenticated;
GRANT ALL ON client_mutations TO service_role;

NOTIFY pgrst, 'reload schema';
