-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260529212127 :: orders_event_id_set_null_on_delete). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Allow event deletion without losing financial audit records.
-- orders.event_id becomes nullable on delete so a deleted (cancelled)
-- event no longer blocks the parent delete, while the order's payment
-- record (amounts, statuses, stripe_payment_intent_id) is preserved
-- for refund disputes and accounting reconciliation.

-- Locate the current FK name (PG generates it as <table>_event_id_fkey
-- in most cases, but we look it up to be safe).
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.orders'::regclass
    AND contype = 'f'
    AND array_length(conkey, 1) = 1
    AND conkey[1] = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.orders'::regclass AND attname = 'event_id'
    );

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE public.orders
    ADD CONSTRAINT orders_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
END $$;;
