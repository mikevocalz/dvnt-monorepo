-- Door POS: seller attribution on orders.
--
-- `sold_by_staff_user_id` records WHICH staff member ran the sale. It is
-- deliberately separate from every other identity on the order:
--   - user_id / guest_email  → the buyer
--   - ticket owner           → the guest (door tickets keep user_id NULL)
--   - Stripe Customer        → the buyer's payment identity
--   - promoter / payout      → commission recipient
-- A scanner must never be able to read other staff's sales; this column is
-- written only by the door-sell edge function (service role) from the
-- verified session, never from client input.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sold_by_staff_user_id text;

COMMENT ON COLUMN orders.sold_by_staff_user_id IS
  'Better Auth id of the staff member who ran a Door POS sale. NULL for online purchases. Written server-side only; never buyer, owner, promoter, or payout identity.';

CREATE INDEX IF NOT EXISTS idx_orders_sold_by
  ON orders(sold_by_staff_user_id)
  WHERE sold_by_staff_user_id IS NOT NULL;

-- Rollback: DROP INDEX idx_orders_sold_by; ALTER TABLE orders DROP COLUMN sold_by_staff_user_id;
-- No rows exist before door-sell ships, so rollback is lossless.
