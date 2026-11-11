-- Source-only. Release with buyer reads on ticket_types_public and manager
-- reads on ticket_types. Never expose unlock codes through the public catalog.
BEGIN;

-- Keep the frozen projection created by 20260806200000: do not dynamically
-- expose subsequently added columns. A definer view is required here: an
-- invoker view inherits manager-only RLS and would hide the catalog from buyers.
-- The existing view intentionally exposes catalog rows publicly; preserve that
-- behavior, including anonymous checkout. Only its safe columns bypass RLS.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ticket_types_public'
      AND column_name='unlock_code') THEN
    RAISE EXCEPTION 'ticket_types_public must not expose unlock_code';
  END IF;
END $$;
ALTER VIEW public.ticket_types_public OWNER TO postgres;
ALTER VIEW public.ticket_types_public SET (security_invoker = false, security_barrier = true);
REVOKE ALL ON public.ticket_types_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_types_public TO anon, authenticated, service_role;
COMMENT ON VIEW public.ticket_types_public IS
  'Read-only buyer catalog with a frozen projection excluding unlock_code. Owner-executed security-barrier view preserves public catalog reads; full base rows require event management permission.';

ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON public.ticket_types FROM PUBLIC, anon;
GRANT SELECT ON public.ticket_types TO authenticated;
DROP POLICY IF EXISTS ticket_types_select ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_select_all ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_select_anon ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_select_management ON public.ticket_types;
CREATE POLICY ticket_types_select_management ON public.ticket_types
  FOR SELECT TO authenticated USING (public.can_edit_event(event_id));
-- A restrictive boundary also prevents legacy/drifted permissive SELECT or ALL
-- policies from accidentally reopening the secret-bearing base table.
DROP POLICY IF EXISTS ticket_types_select_management_boundary ON public.ticket_types;
CREATE POLICY ticket_types_select_management_boundary ON public.ticket_types
  AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_edit_event(event_id));
COMMIT;
