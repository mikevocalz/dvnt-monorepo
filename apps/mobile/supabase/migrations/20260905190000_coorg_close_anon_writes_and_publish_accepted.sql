-- Co-organizers: close the anonymous write hole, then publish the accepted ones.
--
-- 20260333_fix_anon_role_all_tables.sql granted anon SELECT/INSERT/UPDATE/DELETE
-- on event_co_organizers with USING (true). 20260519224308 dropped only the
-- SELECT half, so INSERT/UPDATE/DELETE stayed open: an unauthenticated caller
-- could add themselves as a co-organizer of any event. Publishing co-hosts on
-- the event page turns that into "anyone can bill themselves on anyone's
-- event", so the hole closes in the same migration as the feature.
--
-- Invites are written by the invite-co-organizer edge function under the
-- service role, which bypasses RLS, so no legitimate write path depends on
-- these policies.
--
-- Verified against the live API after applying: an anon POST to
-- /rest/v1/event_co_organizers returns 401 "permission denied for table
-- event_co_organizers", a direct anon table read returns [], and
-- /rest/v1/rpc/get_event_co_organizers returns the accepted co-host.

DROP POLICY IF EXISTS coorg_insert_anon ON public.event_co_organizers;
DROP POLICY IF EXISTS coorg_update_anon ON public.event_co_organizers;
DROP POLICY IF EXISTS coorg_delete_anon ON public.event_co_organizers;

REVOKE INSERT, UPDATE, DELETE ON public.event_co_organizers FROM anon;

-- eventsApi.removeCoOrganizer deletes straight from the client, and the only
-- DELETE policy was the anon one, so a signed-in host could not actually remove
-- anybody. Give the host that right, and let a co-organizer stand down.
DROP POLICY IF EXISTS coorg_delete_host_or_self ON public.event_co_organizers;
CREATE POLICY coorg_delete_host_or_self ON public.event_co_organizers
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_co_organizers.event_id
        AND e.host_id = (SELECT ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    )
  );

-- Public read goes through a definer RPC rather than a table policy, matching
-- get_event_organizer, so the projection is fixed here instead of depending on
-- every caller to select the right columns. auth_id never crosses the boundary.
-- Avatar resolves through media.avatar_id exactly as get_event_organizer does.
--
-- Only ACCEPTED rows: a pending invitee has not agreed to be billed publicly.
-- Only admin/editor: 'scanner' is door staff, not a co-organizer, and the same
-- split already governs edit rights in eventsApi.canEditEvent.
CREATE OR REPLACE FUNCTION public.get_event_co_organizers(p_event_id integer)
RETURNS TABLE (
  username text,
  name text,
  avatar text,
  verified boolean,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.username::text,
    NULLIF(TRIM(COALESCE(u.first_name, '')), '')::text AS name,
    COALESCE(m.url, '')::text AS avatar,
    COALESCE(u.verified, false) AS verified,
    c.role::text
  FROM public.event_co_organizers c
  JOIN public.users u ON u.auth_id = c.user_id
  LEFT JOIN public.media m ON m.id = u.avatar_id
  WHERE c.event_id = p_event_id
    AND c.accepted IS TRUE
    AND c.role IN ('admin', 'editor')
  ORDER BY c.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_event_co_organizers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_co_organizers(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_event_co_organizers(integer) IS
  'Accepted admin/editor co-organizers of an event, as a public projection: username, display name, avatar, verified, role. No auth_id. Pending invitees and scanners are excluded. Mirrors get_event_organizer so co-hosts are visible wherever the host is.';
