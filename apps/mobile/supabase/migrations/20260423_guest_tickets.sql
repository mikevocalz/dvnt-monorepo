-- ══════════════════════════════════════════════════════════════
-- Guest ticket purchases
-- ══════════════════════════════════════════════════════════════
-- Allow tickets to be purchased without a user account. The buyer
-- is identified by email only; payment still routes through Stripe
-- Connect to the organizer, and the QR code + a magic-link lookup
-- token are emailed via Resend after checkout completes.

-- 1. Let tickets.user_id be NULL and add guest identifiers
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS guest_email text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS guest_name  text;
-- guest_lookup_token is a random opaque string used as a magic
-- link on the emailed QR so the guest can later view / add the
-- ticket to their wallet without creating an account.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS guest_lookup_token text;

-- At least one of (user_id, guest_email) must be set.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_user_or_guest;
ALTER TABLE tickets ADD CONSTRAINT tickets_user_or_guest
  CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tickets_guest_email
  ON tickets(guest_email) WHERE guest_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tickets_guest_lookup_token
  ON tickets(guest_lookup_token) WHERE guest_lookup_token IS NOT NULL;

-- 2. Mirror on orders so the bookkeeping row for a guest purchase
--    doesn't fail the NOT NULL on user_id.
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_or_guest;
ALTER TABLE orders ADD CONSTRAINT orders_user_or_guest
  CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_guest_email
  ON orders(guest_email) WHERE guest_email IS NOT NULL;

-- 3. Mirror on ticket_holds so the inventory hold for a guest
--    in-flight checkout doesn't fail NOT NULL on user_id.
ALTER TABLE ticket_holds ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ticket_holds ADD COLUMN IF NOT EXISTS guest_email text;

GRANT ALL ON tickets      TO service_role;
GRANT ALL ON orders       TO service_role;
GRANT ALL ON ticket_holds TO service_role;

NOTIFY pgrst, 'reload schema';
