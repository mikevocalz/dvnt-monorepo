-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614232052 :: revoke_anon_writes_ticket_types). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Defense-in-depth: anon must only SELECT tiers (for guest checkout), never
-- write them. RLS already lacks an anon write policy, but drop the stray grants
-- too (same class as the events anon-write grants already revoked).
revoke insert, update, delete on public.ticket_types from anon;;
