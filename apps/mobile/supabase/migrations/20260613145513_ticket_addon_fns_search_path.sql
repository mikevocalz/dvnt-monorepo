-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613145513 :: ticket_addon_fns_search_path). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Pin search_path on the v2 helper functions (advisor: function_search_path_mutable).
ALTER FUNCTION public.ticket_type_available(uuid) SET search_path = public;
ALTER FUNCTION public.ticket_type_current_price_cents(uuid) SET search_path = public;
ALTER FUNCTION public.addon_available(uuid) SET search_path = public;
ALTER FUNCTION public.addon_variant_available(uuid) SET search_path = public;;
