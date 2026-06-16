-- ══════════════════════════════════════════════════════════════
-- Phase 5: Ticket Transfers
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ticket_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  initiated_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_ticket_transfers_ticket ON ticket_transfers(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_from ON ticket_transfers(from_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_transfers_to ON ticket_transfers(to_user_id, status);

ALTER TABLE ticket_transfers ENABLE ROW LEVEL SECURITY;

-- Sender and recipient can read their own transfers
DROP POLICY IF EXISTS "ticket_transfers_select" ON ticket_transfers;
CREATE POLICY "ticket_transfers_select" ON ticket_transfers FOR SELECT
  USING (
    from_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    OR to_user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );

GRANT SELECT ON ticket_transfers TO authenticated;
GRANT ALL ON ticket_transfers TO service_role;

-- Add transferred_from column to tickets for audit trail
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transferred_from text;

-- Expand tickets status CHECK to include transfer_pending
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('active','scanned','refunded','void','transfer_pending'));

NOTIFY pgrst, 'reload schema';
