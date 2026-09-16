-- link_only promises "not listed, but anyone with the link can open it".
-- Neither half held.
--
--   1. The anon SELECT policy was `visibility = ANY (ARRAY['public','link_only'])`,
--      so GET /rest/v1/events?select=* with the publishable key returned every
--      link_only event to anyone. No link required.
--   2. share_slug was NULL on every row and create-event never set one, so the
--      only URL an event had was slugify(title) over a 500-row fetch. "Wine &
--      Whiskey WEDNESDAY" was /events/wine-whiskey-wednesday — derivable from
--      the title alone.
--
-- Production today is 24 public, 1 private, 0 link_only, so the hole is latent:
-- it opens the first time a host picks the option. This migration makes
-- possession of the link the thing that grants access.
--
-- ponytail: this closes the LISTING door, not the id door. get_event_detail is
-- SECURITY DEFINER, granted to anon, and gated on can_view_event, which allows
-- anything that is not private — so `rpc/get_event_detail {p_event_id: N}` still
-- returns a link_only event to an anonymous caller who walks the integer ids.
-- Ceiling accepted on purpose: that same call is how a recipient who followed a
-- share link renders the page (token → id → detail), so narrowing can_view_event
-- would break the feature this migration exists to deliver. Closing it properly
-- means carrying the token through to the detail read, which is a bigger change
-- than the one the audit asked for.

-- ── 1. Every event gets an unguessable token ───────────────────────────────
-- gen_random_uuid() is the generator issue_guest_comp_tickets_atomic already
-- uses for guest_lookup_token. Dashes stripped so the token is 32 hex chars in
-- a URL; 122 bits of entropy either way. Chosen over encode(gen_random_bytes())
-- deliberately: gen_random_uuid() is in pg_catalog, so a column DEFAULT
-- referencing it needs no extensions-schema qualification and no EXECUTE grant
-- to the inserting role (events_insert_authenticated lets clients insert too).
ALTER TABLE public.events
  ALTER COLUMN share_slug SET DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Backfill. gen_random_uuid() is VOLATILE, so each row gets its own token; the
-- column already carries a UNIQUE constraint and 122 bits does not collide.
-- Existing rows are all public and stay resolvable by their title slug, so no
-- currently-shared URL changes meaning — the token is an additional way in.
UPDATE public.events
SET share_slug = replace(gen_random_uuid()::text, '-', '')
WHERE share_slug IS NULL;

-- A link_only event without a token would have no private URL at all, which is
-- the failure this migration exists to prevent. No code writes share_slug
-- explicitly, so nothing can pass NULL past the default.
ALTER TABLE public.events ALTER COLUMN share_slug SET NOT NULL;

COMMENT ON COLUMN public.events.share_slug IS
  'Random 32-hex share token, defaulted on insert. For link_only events this is the ONLY way in: anon RLS hides the row and the title slug does not resolve it. Public events are still resolvable by slugify(title), so the token is additive for them.';

-- ── 2. Anonymous enumeration ───────────────────────────────────────────────
-- Composition: events_private_boundary is RESTRICTIVE and ANDs with every
-- PERMISSIVE policy, so narrowing this one can only ever remove rows — it
-- cannot widen private access. events_select_authenticated (USING true) is
-- untouched, so a signed-in member still reads public + link_only and the
-- RESTRICTIVE boundary still decides private. After this, anon reads public
-- only; a link_only row reaches anon exclusively through the token RPC below.
DROP POLICY IF EXISTS "events_select_anon" ON public.events;
CREATE POLICY "events_select_anon" ON public.events
  FOR SELECT TO anon
  USING (visibility = 'public');

-- ── 3. Resolving a token ───────────────────────────────────────────────────
-- SECURITY DEFINER because the whole point is to return a row anon RLS now
-- hides. The bypass is paid for by the token: 122 bits, supplied by the caller,
-- never enumerable. private is excluded unconditionally — can_view_event and
-- events_private_boundary are the authority there and neither is touched here,
-- so a private event's token resolves to nothing even if one leaks.
--
-- Hidden statuses match HIDDEN_STATUSES in packages/app/lib/events/event-discovery.ts.
--
-- ponytail: RETURNS SETOF public.events hands back every column, same shape the
-- REST list already returns for a public event. Ceiling: if a column is ever
-- added to events that anon must not see, it leaks here too and this needs a
-- named projection. A cancelled link_only event also 404s instead of showing
-- the "this event was cancelled" takeover — ticket holders still reach it by id.
CREATE OR REPLACE FUNCTION public.get_event_by_share_token(p_token text)
RETURNS SETOF public.events
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT e.* FROM public.events e
  WHERE p_token IS NOT NULL
    AND length(p_token) >= 32
    AND e.share_slug = p_token
    AND e.visibility IN ('public', 'link_only')
    AND COALESCE(e.status, 'active')
        NOT IN ('draft', 'cancelled', 'canceled', 'suspended')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_event_by_share_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_by_share_token(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_event_by_share_token(text) IS
  'Resolve an event by its share_slug token. Returns public and link_only events only; private and hidden-status rows resolve to nothing. The only path by which anon reaches a link_only event.';

NOTIFY pgrst, 'reload schema';
