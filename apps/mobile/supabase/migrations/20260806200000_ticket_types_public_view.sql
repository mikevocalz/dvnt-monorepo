-- ════════════════════════════════════════════════════════════════════════
-- ticket_types_public — buyer-safe view of ticket_types WITHOUT unlock_code.
--
-- WHY: ticket_types has public SELECT (anon + authenticated, RLS
-- `ticket_types_select` USING(true) — 20260301/20260313/20260329/20260333),
-- and buyer paths do `select("*")` (ticketsApi.getTicketTypes,
-- ticketTypesApi.getByEvent), so the tier-model-v2 `unlock_code` column
-- (20260613000000) is readable by ANY client — the "secret" code leaks.
--
-- WHY NOT `REVOKE SELECT (unlock_code) ... FROM anon, authenticated`:
-- PostgREST expands `select=*` to every column it introspected; a
-- column-level REVOKE makes that expansion fail the WHOLE query with a
-- permissions error (42501) rather than silently omitting the column.
-- Every existing `select("*")` buyer read would break.
--
-- WHY NOT revoking table SELECT and pointing clients at the view now:
-- 11 direct `.from("ticket_types")` call sites exist across
-- packages/app/lib/api/{ticket-types,events,tickets}.ts and their
-- apps/mobile/lib mirrors (plus host editors that legitimately need
-- unlock_code to display/edit it). Revoking today breaks prod reads —
-- worse than the leak persisting one more wave.
--
-- WHAT SHIPS HERE: the canonical buyer read surface for the follow-up
-- sweep. security_invoker = true so the existing ticket_types RLS policies
-- run as the querying role (anon/authenticated), exactly as they do on the
-- base table — this view only strips the column, it does not widen access.
--
-- The column list is built dynamically from the catalog (all columns minus
-- unlock_code) so this migration is correct even if prod has drifted extra
-- columns (drift is a live phenomenon here — see 20260805130000). NOTE:
-- columns added to ticket_types AFTER this runs are NOT auto-exposed;
-- future tier-column migrations must recreate the view.
--
-- TODO(follow-up sweep): repoint buyer reads (ticketsApi.getTicketTypes,
-- events.ts enrichEventsWithTierPrices, buyer-facing getByEvent) at
-- ticket_types_public, keep host editors on ticket_types (they need
-- unlock_code), THEN revoke buyer-role SELECT on ticket_types (or revoke
-- only from anon and gate authenticated via an RLS host check).
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'ticket_types'
    AND column_name <> 'unlock_code';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'ticket_types has no columns — aborting view creation';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW public.ticket_types_public
       WITH (security_invoker = true) AS
     SELECT %s FROM public.ticket_types',
    v_cols
  );
END $$;

COMMENT ON VIEW public.ticket_types_public IS
  'Buyer-safe projection of ticket_types: every column except unlock_code. security_invoker=true — the caller''s own RLS applies. Canonical buyer read path; hosts keep reading ticket_types directly (they own the code).';

GRANT SELECT ON public.ticket_types_public TO anon, authenticated;
GRANT SELECT ON public.ticket_types_public TO service_role;

-- Deliberately NO revoke on public.ticket_types here (see header). The
-- unlock path itself never depends on client reads: code validation is
-- server-side only (unlock-ticket-tier edge fn + cart_create_hold
-- p_unlock_codes, migration 20260806201000).
