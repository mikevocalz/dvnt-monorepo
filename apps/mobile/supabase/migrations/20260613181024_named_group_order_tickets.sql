-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613181024 :: named_group_order_tickets). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS order_index integer,
  ADD COLUMN IF NOT EXISTS order_count integer,
  ADD COLUMN IF NOT EXISTS attendee_name text,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_order_index_check;
  ALTER TABLE public.tickets ADD CONSTRAINT tickets_order_index_check
    CHECK (order_index IS NULL OR order_index >= 1);
  ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_order_count_check;
  ALTER TABLE public.tickets ADD CONSTRAINT tickets_order_count_check
    CHECK (order_count IS NULL OR order_count >= 1);
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_cart_order_index
  ON public.tickets(cart_id, order_index) WHERE cart_id IS NOT NULL;;
