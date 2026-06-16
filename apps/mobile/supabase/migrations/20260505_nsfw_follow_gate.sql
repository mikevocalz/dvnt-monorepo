-- ============================================================
-- NSFW Follow Gate (2026-05-05)
--
-- Spicy content (is_nsfw=true posts, nsfw=true events) is now
-- ONLY visible to:
--   a) The content creator / event host themselves
--   b) Authenticated users who explicitly follow that creator
--
-- Non-logged-in visitors and non-followers always see the
-- safe (non-spicy) view, regardless of client-side toggle state.
--
-- Changes:
--   1. Helper function viewer_can_see_nsfw(viewer_id, author_id)
--   2. get_events_home updated: p_nsfw=true requires follow relationship
-- ============================================================

-- ── 1. Helper function ────────────────────────────────────────────────
--
-- Returns TRUE if the viewer is allowed to see nsfw content from
-- a given author: viewer must be logged in AND (follows author OR is author).

CREATE OR REPLACE FUNCTION public.viewer_can_see_nsfw(
  p_viewer_id  integer,
  p_author_id  integer
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_viewer_id IS NOT NULL
    AND p_author_id IS NOT NULL
    AND (
      p_viewer_id = p_author_id
      OR EXISTS (
        SELECT 1
        FROM follows f
        WHERE f.follower_id = p_viewer_id
          AND f.following_id = p_author_id
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.viewer_can_see_nsfw(integer, integer)
  TO authenticated, anon, service_role;


-- ── 2. Update get_events_home ─────────────────────────────────────────
--
-- Previous nsfw gate:
--   AND (p_nsfw IS NULL OR COALESCE(e.nsfw, false) = p_nsfw)
--   → spicy events were returned to ANY caller when p_nsfw=true
--
-- New nsfw gate:
--   p_nsfw = NULL  → all events (no filter, same as before)
--   p_nsfw = false → non-spicy only (same as before)
--   p_nsfw = true  → spicy only, AND viewer must follow the host
--                    (or be the host). Guest (p_viewer_id NULL) gets nothing.

CREATE OR REPLACE FUNCTION public.get_events_home(
  p_limit          integer  DEFAULT 20,
  p_offset         integer  DEFAULT 0,
  p_viewer_id      integer  DEFAULT NULL,
  p_city_id        integer  DEFAULT NULL,
  p_filter_online  boolean  DEFAULT NULL,
  p_filter_tonight boolean  DEFAULT false,
  p_filter_weekend boolean  DEFAULT false,
  p_search         text     DEFAULT NULL,
  p_category       text     DEFAULT NULL,
  p_sort           text     DEFAULT 'soonest',
  p_nsfw           boolean  DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_result        JSON;
  v_tonight_start timestamptz;
  v_tonight_end   timestamptz;
  v_weekend_start timestamptz;
  v_weekend_end   timestamptz;
BEGIN
  v_tonight_start := date_trunc('day', now());
  v_tonight_end   := v_tonight_start + interval '1 day';
  v_weekend_start := CASE
    WHEN extract(dow FROM now()) = 0 THEN date_trunc('day', now())
    WHEN extract(dow FROM now()) = 6 THEN date_trunc('day', now())
    ELSE date_trunc('day', now()) + ((6 - extract(dow FROM now())) || ' days')::interval
  END;
  v_weekend_end := v_weekend_start + interval '2 days';

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      e.id, e.title, e.description, e.start_date, e.end_date, e.location,
      COALESCE(e.cover_image_url, e.image, '') AS image,
      COALESCE(e.images, '[]'::jsonb) AS images,
      e.youtube_video_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.category::text, e.visibility, e.location_type,
      e.age_restriction, e.ticketing_enabled, e.share_slug,
      COALESCE(e.nsfw, false) AS nsfw,
      host_data.username  AS host_username,
      host_data.avatar_url AS host_avatar,
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0)   AS rsvp_count,
      CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
           THEN true ELSE false END AS is_liked,
      COALESCE(lc.cnt, 0) AS likes_count
    FROM events e
    LEFT JOIN LATERAL (
      SELECT u.username, m.url AS avatar_url, ba.name AS host_name,
             u.id AS host_int_id
      FROM users u
      LEFT JOIN media m ON m.id = u.avatar_id
      LEFT JOIN "user" ba ON ba.id = u.auth_id
      WHERE u.auth_id = e.host_id
      LIMIT 1
    ) host_data ON true
    LEFT JOIN LATERAL (
      SELECT
        json_agg(json_build_object(
          'image',    COALESCE(am.url, ''),
          'initials', COALESCE(upper(left(au.username, 2)), '??')
        )) AS avatars,
        count(*)::integer AS attendee_count
      FROM (
        SELECT er.user_id AS rsvp_auth_id
        FROM event_rsvps er
        WHERE er.event_id = e.id AND er.status = 'going'
        ORDER BY er.created_at DESC
        LIMIT 5
      ) top_rsvps
      LEFT JOIN users au ON au.auth_id = top_rsvps.rsvp_auth_id
      LEFT JOIN media am ON am.id = au.avatar_id
    ) att ON true
    LEFT JOIN event_likes el
      ON el.event_id = e.id AND el.user_id = p_viewer_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
      FROM event_likes el2
      WHERE el2.event_id = e.id
    ) lc ON true
    WHERE e.start_date IS NOT NULL
      AND COALESCE(e.visibility, 'public') = 'public'
      -- ── nsfw follow gate ──────────────────────────────────────────
      -- NULL  → no filter (all events)
      -- false → safe only  (non-spicy)
      -- true  → spicy only AND viewer must follow the host
      AND CASE
        WHEN p_nsfw IS NULL  THEN true
        WHEN p_nsfw = false  THEN NOT COALESCE(e.nsfw, false)
        WHEN p_nsfw = true   THEN
          COALESCE(e.nsfw, false) = true
          AND public.viewer_can_see_nsfw(p_viewer_id, host_data.host_int_id)
        ELSE false
      END
      -- ── other filters (unchanged) ─────────────────────────────────
      AND (p_filter_online IS NULL OR
           (p_filter_online = true AND e.location_type = 'virtual') OR
           (p_filter_online = false AND (e.location_type IS NULL OR e.location_type = 'physical')))
      AND (p_filter_tonight = false OR
           (e.start_date >= v_tonight_start AND e.start_date < v_tonight_end))
      AND (p_filter_weekend = false OR
           (e.start_date >= v_weekend_start AND e.start_date < v_weekend_end))
      AND (p_search IS NULL OR p_search = '' OR
           e.title       ILIKE '%' || p_search || '%' OR
           e.description ILIKE '%' || p_search || '%' OR
           e.location    ILIKE '%' || p_search || '%' OR
           host_data.username  ILIKE '%' || p_search || '%' OR
           host_data.host_name ILIKE '%' || p_search || '%')
      AND (p_category IS NULL OR p_category = '' OR e.category::text = p_category)
    ORDER BY
      CASE p_sort
        WHEN 'newest'     THEN extract(epoch FROM e.created_at) * -1
        WHEN 'popular'    THEN COALESCE(e.total_attendees, 0) * -1
        WHEN 'price_low'  THEN COALESCE(e.price, 0)
        WHEN 'price_high' THEN COALESCE(e.price, 0) * -1
        ELSE extract(epoch FROM e.start_date)
      END ASC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Re-grant (same signature as before — just replacing body)
GRANT EXECUTE ON FUNCTION public.get_events_home(integer, integer, integer, integer, boolean, boolean, boolean, text, text, text, boolean)
  TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
