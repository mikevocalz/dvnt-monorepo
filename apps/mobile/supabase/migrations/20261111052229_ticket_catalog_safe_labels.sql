-- Additive rollout prerequisite. Apply before updated clients; this does not
-- revoke or alter legacy buyer reads. Restrictive catalog RLS ships only after
-- compatible clients are available under the coordinated release plan.
BEGIN;

-- Historical transfers/check-ins still need a retired tier's label. Expose
-- only these non-secret fields, never resurrect retired buyer inventory. The
-- id preserves PostgREST's FK inference for aliased ticket relation joins.
CREATE OR REPLACE VIEW public.ticket_type_labels WITH (security_invoker=false, security_barrier=true) AS
  SELECT id, name, category FROM public.ticket_types WHERE public.can_view_event(event_id);
ALTER VIEW public.ticket_type_labels OWNER TO postgres;
REVOKE ALL ON public.ticket_type_labels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_type_labels TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
