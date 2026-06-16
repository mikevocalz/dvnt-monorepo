-- ============================================================================
-- Apple Wallet Pass Support
-- Adds wallet tracking columns to tickets + device registration table
-- for Apple's PassKit web service protocol.
-- ============================================================================

-- ── 1. Wallet pass columns on tickets ────────────────────────────────
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS wallet_serial_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS wallet_auth_token text,
  ADD COLUMN IF NOT EXISTS wallet_pass_type_id text,
  ADD COLUMN IF NOT EXISTS wallet_last_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS wallet_voided_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_wallet_serial
  ON tickets(wallet_serial_number) WHERE wallet_serial_number IS NOT NULL;

-- ── 2. Apple Wallet device registrations ─────────────────────────────
-- Apple's PassKit protocol: devices register to receive push updates.
-- One device can register for many passes; one pass can be on many devices.
CREATE TABLE IF NOT EXISTS wallet_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_library_id text NOT NULL,
  push_token text NOT NULL,
  serial_number text NOT NULL,
  pass_type_id text NOT NULL,
  registered_at timestamptz DEFAULT now(),
  UNIQUE (device_library_id, serial_number, pass_type_id)
);

CREATE INDEX IF NOT EXISTS idx_wallet_reg_serial
  ON wallet_registrations(serial_number, pass_type_id);
CREATE INDEX IF NOT EXISTS idx_wallet_reg_device
  ON wallet_registrations(device_library_id);

-- ── 3. RLS + Grants ──────────────────────────────────────────────────
ALTER TABLE wallet_registrations ENABLE ROW LEVEL SECURITY;

-- wallet_registrations is managed exclusively by service_role (edge functions)
-- No authenticated user access needed — Apple's server-to-server protocol
GRANT ALL ON wallet_registrations TO service_role;

-- Ensure service_role can update the new wallet columns on tickets
GRANT UPDATE (wallet_serial_number, wallet_auth_token, wallet_pass_type_id, wallet_last_pushed_at, wallet_voided_at)
  ON tickets TO service_role;

-- ── 4. Reload schema cache ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
