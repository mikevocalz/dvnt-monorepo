-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518172751 :: v2_db_01_enable_rls_on_public_tables). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- V2-DB-01: Enable RLS on 3 public tables.
-- All 3 are server-only (written by triggers / edge functions, never read by clients).
-- Enabling RLS with no policies = anon/authenticated denied, service_role bypasses RLS (still works).

ALTER TABLE public.content_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sneaky_usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liked_activity_history ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicit deny policies for anon/authenticated.
-- (RLS-enabled-with-no-policy already denies, but a named deny policy makes intent explicit.)

CREATE POLICY "deny_all_anon_authenticated" ON public.content_audit_log
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_anon_authenticated" ON public.sneaky_usage_tracking
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE POLICY "deny_all_anon_authenticated" ON public.liked_activity_history
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);;
