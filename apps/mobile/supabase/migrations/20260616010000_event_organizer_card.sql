-- ──────────────────────────────────────────────────────────────────────────
-- Event "Hosted by" organizer card (Posh-style)
--
-- One round-trip payload for the organizer section on the event detail page:
-- the host's identity (name/avatar/verified), aggregate stats (events hosted +
-- total attendees across their public events), their website + social links,
-- and whether the current viewer already follows them.
--
-- Mirrors get_event_detail's host join (events.host_id is an auth uuid; the
-- users row is keyed by users.auth_id). p_viewer_id is the integer users.id of
-- the viewer (NULL for guests) — matching every other detail RPC.
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_event_organizer(
  p_event_id integer,
  p_viewer_id integer DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id', u.id,
    'username', u.username,
    'first_name', u.first_name,
    'avatar', COALESCE(m.url, ''),
    'verified', COALESCE(u.verified, false),
    'followers_count', COALESCE(u.followers_count, 0),
    'website', u.website,
    'links', COALESCE(u.links, '[]'::jsonb),
    -- Aggregate stats across this host's visible, non-cancelled events
    'events_count', COALESCE(agg.events_count, 0),
    'total_attendees', COALESCE(agg.total_attendees, 0),
    -- Viewer relationship
    'is_following', CASE
      WHEN p_viewer_id IS NULL THEN false
      ELSE EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = p_viewer_id
          AND f.following_id = u.id
      )
    END,
    'is_self', (p_viewer_id IS NOT NULL AND p_viewer_id = u.id)
  )
  FROM events ev
  JOIN users u ON u.auth_id = ev.host_id
  LEFT JOIN media m ON m.id = u.avatar_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS events_count,
      COALESCE(sum(COALESCE(e2.total_attendees, 0)), 0)::bigint AS total_attendees
    FROM events e2
    WHERE e2.host_id = ev.host_id
      AND COALESCE(e2.visibility, 'public') = 'public'
      AND COALESCE(e2.status, 'active') <> 'cancelled'
  ) agg ON true
  WHERE ev.id = p_event_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_organizer(integer, integer) TO anon, authenticated, service_role;
