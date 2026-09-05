-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519203218 :: rls_consolidate_permissive_dupes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- multiple_permissive_policies cleanup.
-- The advisor flagged 24 overlapping combos on push_tokens and 13 on
-- notifications. In every case the duplicates were *identical*
-- USING(true) / WITH CHECK(true) policies that differed only by name
-- and role (and `public` already covers anon + authenticated, so the
-- role-specific ones are pure noise). Dropping the redundant siblings
-- keeps the same effective access rule, just expressed once.

-- push_tokens: keep `Allow all for push_tokens` (ALL/public/true).
DROP POLICY IF EXISTS "anon_select" ON public.push_tokens;
DROP POLICY IF EXISTS "push_tokens_delete_all" ON public.push_tokens;
DROP POLICY IF EXISTS "push_tokens_insert_all" ON public.push_tokens;
DROP POLICY IF EXISTS "push_tokens_select_all" ON public.push_tokens;
DROP POLICY IF EXISTS "push_tokens_update_all" ON public.push_tokens;

-- notifications: keep the three "human-named" ones to public; drop the
-- 8 role-scoped duplicates that say exactly the same thing.
DROP POLICY IF EXISTS "anon_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_anon" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_all" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_anon" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_anon" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_authenticated" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;;
