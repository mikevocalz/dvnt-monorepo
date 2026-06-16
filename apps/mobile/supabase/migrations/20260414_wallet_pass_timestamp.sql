-- ============================================================
-- DVNT Ticket Wallet Pass Timestamp
-- Tracks when wallet pass was last generated to detect stale passes
-- after ticket upgrades
-- ============================================================

-- PLAN:
-- Add wallet_pass_updated_at to track when user last generated wallet pass
-- This enables detecting stale passes after ticket upgrades

-- PROVE (verify current state):
-- SELECT COUNT(*) FROM tickets WHERE wallet_pass_updated_at IS NOT NULL;

-- APPLY:
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS wallet_pass_updated_at timestamptz;

-- Index for efficient lookup
CREATE INDEX IF NOT EXISTS idx_tickets_wallet_updated ON tickets(wallet_pass_updated_at);

-- Initialize existing rows to created_at (assume passes are current at creation)
UPDATE tickets
SET wallet_pass_updated_at = created_at
WHERE wallet_pass_updated_at IS NULL;

-- VERIFY:
-- SELECT id, wallet_pass_updated_at, updated_at, created_at FROM tickets LIMIT 5;

-- ROLLBACK (if needed):
-- ALTER TABLE tickets DROP COLUMN IF EXISTS wallet_pass_updated_at;

-- NOTE: This migration is idempotent and safe to run multiple times
