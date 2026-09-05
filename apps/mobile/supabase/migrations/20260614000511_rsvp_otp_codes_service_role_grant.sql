-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614000511 :: rsvp_otp_codes_service_role_grant). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- The OTP table must be reachable by the edge function (service_role). anon /
-- authenticated stay denied (no grant + RLS deny-all) so only the rsvp-verify
-- function can touch it.
grant select, insert, update on public.rsvp_otp_codes to service_role;;
