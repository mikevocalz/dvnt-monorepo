-- Preserve the original discount/order ledger while allowing an organizer to
-- remove a promo code from checkout. Hard-deleting referenced codes violates
-- orders.promo_code_id's foreign key and can destroy attribution history.
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS promo_codes_active_event_idx
  ON public.promo_codes (event_id)
  WHERE deleted_at IS NULL;
