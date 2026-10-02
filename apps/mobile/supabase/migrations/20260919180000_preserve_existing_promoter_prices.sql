-- Existing codes remain attribution-only, per Mike's September 19 decision.
-- Apply once through the migration ledger. Do not replay after new discounts
-- have been explicitly configured. Historical orders/attributions are untouched.
UPDATE public.event_promoters
SET customer_discount_bps = 0
WHERE customer_discount_bps <> 0;

-- Older clients that only send a revenue-share rate must not create discounts.
ALTER TABLE public.event_promoters
  ALTER COLUMN customer_discount_bps SET DEFAULT 0;

NOTIFY pgrst, 'reload schema';
