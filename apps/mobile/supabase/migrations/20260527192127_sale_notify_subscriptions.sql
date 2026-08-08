-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260527192127 :: sale_notify_subscriptions). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Sale-open notification subscriptions.
-- One row per (user, event) the user wants reminders for. notified_at is set
-- when the cron dispatcher has fired the "tickets on sale" push, preventing
-- duplicate sends if the cron runs again before tier.sale_start moves.
CREATE TABLE IF NOT EXISTS public.sale_notify_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ NULL,
  UNIQUE (event_id, user_id)
);

-- Lookup-by-event when sale opens (cron dispatcher hot path).
CREATE INDEX IF NOT EXISTS sale_notify_subscriptions_event_idx
  ON public.sale_notify_subscriptions (event_id)
  WHERE notified_at IS NULL;

-- Lookup-by-user for "show my subscriptions" reads.
CREATE INDEX IF NOT EXISTS sale_notify_subscriptions_user_idx
  ON public.sale_notify_subscriptions (user_id);

-- Service role bypasses RLS but explicit GRANT is required per CLAUDE.md
-- so privileged edge functions can read/write.
GRANT ALL ON public.sale_notify_subscriptions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sale_notify_subscriptions_id_seq TO service_role;

-- Anon can do nothing — all access goes through edge functions.
ALTER TABLE public.sale_notify_subscriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sale_notify_subscriptions IS
  'Users opting in to be notified when an event''s ticket sales open. Cron dispatcher in notify_sale_open scans rows where notified_at IS NULL against the earliest ticket_types.sale_start per event, sends Expo push, sets notified_at.';;
