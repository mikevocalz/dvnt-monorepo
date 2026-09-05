-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260617021750 :: event_organizer_card). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

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
    'events_count', COALESCE(agg.events_count, 0),
    'total_attendees', COALESCE(agg.total_attendees, 0),
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

GRANT EXECUTE ON FUNCTION public.get_event_organizer(integer, integer) TO anon, authenticated, service_role;;
