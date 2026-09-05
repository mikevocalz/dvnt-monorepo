-- membership-checkout resolves a plan's Stripe price as: env var
-- (stripe_price_env) → membership_plans.stripe_price_id (cache) → create a
-- price on demand from price_cents and cache it back. The cache column never
-- existed, so the fallback SELECT errored, no price resolved, and every
-- membership-tier checkout failed ("Plan price not configured") — the web
-- Choose-plan button bounced to /pricing instead of Stripe. Add the column;
-- the function then self-provisions prices with no manual Stripe setup.

alter table public.membership_plans
  add column if not exists stripe_price_id text;
