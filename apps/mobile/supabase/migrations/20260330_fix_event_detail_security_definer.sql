-- ============================================================
-- Fix: restore SECURITY DEFINER on all client-facing RPCs
--
-- Several migrations re-created functions WITHOUT SECURITY DEFINER,
-- overwriting earlier versions that had it. The Supabase client runs
-- as anon role only — without SECURITY DEFINER these functions
-- cannot read/write through RLS.
--
-- Also drops the stale 9-param get_events_home overload that was
-- shadowing the correct 10-param version with p_sort.
-- ============================================================

-- 1. get_event_detail (broken by migration 20260316)
ALTER FUNCTION public.get_event_detail(integer, integer)
  SECURITY DEFINER
  SET search_path = public;

-- 2. Drop stale 9-param get_events_home (no p_sort, no SECURITY DEFINER)
DROP FUNCTION IF EXISTS public.get_events_home(integer, integer, integer, integer, boolean, boolean, boolean, text, text);

-- 3. get_verification_status
ALTER FUNCTION public.get_verification_status(text)
  SECURITY DEFINER
  SET search_path = public;

-- 4. submit_verification_request
ALTER FUNCTION public.submit_verification_request(text, text, text)
  SECURITY DEFINER
  SET search_path = public;

-- 5. increment_event_attendees
ALTER FUNCTION public.increment_event_attendees(integer)
  SECURITY DEFINER
  SET search_path = public;

-- 6. Sync users_id_seq with current max ID (was at 16, max ID was 39)
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.users), false);

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
