-- Pin search_path on the tier/add-on helper functions added in this wave
-- (Supabase advisor: function_search_path_mutable). Read-only STABLE helpers;
-- pinning search_path is best practice and clears the only advisories these
-- migrations introduced. Idempotent.
ALTER FUNCTION public.ticket_type_available(uuid) SET search_path = public;
ALTER FUNCTION public.ticket_type_current_price_cents(uuid) SET search_path = public;
ALTER FUNCTION public.addon_available(uuid) SET search_path = public;
ALTER FUNCTION public.addon_variant_available(uuid) SET search_path = public;
