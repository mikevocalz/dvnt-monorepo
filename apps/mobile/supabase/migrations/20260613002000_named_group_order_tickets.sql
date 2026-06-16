-- ════════════════════════════════════════════════════════════════════════
-- Named + group-order tickets (Eventbrite/Posh parity, prompt 4.5.5 / 5.6.5a).
-- The order is the parent; each ticket is a child carrying its position
-- (order_index 1..N, order_count N) + an optional attendee name + per-child
-- claim state (so an individual ticket can be sent/claimed via its own
-- capability token — tickets.guest_lookup_token already exists). Additive +
-- idempotent.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS order_index integer,            -- 1..N within the order
  ADD COLUMN IF NOT EXISTS order_count integer,            -- N (total in the order)
  ADD COLUMN IF NOT EXISTS attendee_name text,             -- per-ticket name (named tickets)
  ADD COLUMN IF NOT EXISTS claimed_by text,                -- user_id/email a sent child was claimed by
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_order_index_check;
  ALTER TABLE public.tickets ADD CONSTRAINT tickets_order_index_check
    CHECK (order_index IS NULL OR order_index >= 1);
  ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_order_count_check;
  ALTER TABLE public.tickets ADD CONSTRAINT tickets_order_count_check
    CHECK (order_count IS NULL OR order_count >= 1);
EXCEPTION WHEN others THEN NULL; END $$;

-- Fast lookup of all children of a cart/order, ordered for "Ticket N of M".
CREATE INDEX IF NOT EXISTS idx_tickets_cart_order_index
  ON public.tickets(cart_id, order_index) WHERE cart_id IS NOT NULL;
