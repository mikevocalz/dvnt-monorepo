-- ============================================================
-- Batch RPCs for Events — eliminates N+1 waterfall queries
-- ============================================================

-- ── 1. get_events_home ──────────────────────────────────────
-- Returns events with host info, top attendee avatars, like status
-- in a SINGLE round-trip. Replaces 4 sequential client queries.

CREATE OR REPLACE FUNCTION public.get_events_home(
  p_limit    integer DEFAULT 20,
  p_offset   integer DEFAULT 0,
  p_viewer_id integer DEFAULT NULL,       -- users.id (integer) for like check
  p_city_id  integer DEFAULT NULL,         -- filter by city (unused for now)
  p_filter_online boolean DEFAULT NULL,    -- true = virtual only
  p_filter_tonight boolean DEFAULT false,  -- today only
  p_filter_weekend boolean DEFAULT false,  -- this Sat/Sun
  p_search   text DEFAULT NULL,            -- title/description/location search
  p_category text DEFAULT NULL,            -- category filter
  p_sort     text DEFAULT 'soonest'        -- soonest|newest|popular|price_low|price_high
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_tonight_start timestamptz;
  v_tonight_end   timestamptz;
  v_weekend_start timestamptz;
  v_weekend_end   timestamptz;
BEGIN
  -- Pre-compute date ranges
  v_tonight_start := date_trunc('day', now());
  v_tonight_end   := v_tonight_start + interval '1 day';

  -- Weekend = next Saturday 00:00 to Sunday 23:59:59
  -- If today IS Saturday or Sunday, use today
  v_weekend_start := CASE
    WHEN extract(dow FROM now()) = 0 THEN date_trunc('day', now()) -- Sunday
    WHEN extract(dow FROM now()) = 6 THEN date_trunc('day', now()) -- Saturday
    ELSE date_trunc('day', now()) + ((6 - extract(dow FROM now())) || ' days')::interval
  END;
  v_weekend_end := v_weekend_start + interval '2 days';

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      e.id,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.location,
      COALESCE(e.cover_image_url, e.image, '') AS image,
      COALESCE(e.images, '[]'::jsonb) AS images,
      e.youtube_video_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees,
      e.category,
      e.visibility,
      e.location_type,
      e.age_restriction,
      e.ticketing_enabled,
      e.share_slug,
      -- Host info (single lateral join)
      host_data.username AS host_username,
      host_data.avatar_url AS host_avatar,
      -- Top 5 attendee avatars
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0) AS rsvp_count,
      -- Like status for viewer
      CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
           THEN true ELSE false END AS is_liked
    FROM events e
    -- Host join
    LEFT JOIN LATERAL (
      SELECT
        u.username,
        m.url AS avatar_url
      FROM users u
      LEFT JOIN media m ON m.id = u.avatar_id
      WHERE u.auth_id = e.host_id
      LIMIT 1
    ) host_data ON true
    -- Top attendee avatars (max 5)
    LEFT JOIN LATERAL (
      SELECT
        json_agg(json_build_object(
          'image', COALESCE(am.url, ''),
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
    -- Like check for viewer
    LEFT JOIN event_likes el
      ON el.event_id = e.id AND el.user_id = p_viewer_id
    WHERE e.start_date IS NOT NULL
      -- Filters
      AND (p_filter_online IS NULL OR
           (p_filter_online = true AND e.location_type = 'virtual') OR
           (p_filter_online = false AND (e.location_type IS NULL OR e.location_type = 'physical')))
      AND (p_filter_tonight = false OR
           (e.start_date >= v_tonight_start AND e.start_date < v_tonight_end))
      AND (p_filter_weekend = false OR
           (e.start_date >= v_weekend_start AND e.start_date < v_weekend_end))
      AND (p_search IS NULL OR p_search = '' OR
           e.title ILIKE '%' || p_search || '%' OR
           e.description ILIKE '%' || p_search || '%' OR
           e.location ILIKE '%' || p_search || '%')
      AND (p_category IS NULL OR p_category = '' OR e.category = p_category)
    ORDER BY
      CASE p_sort
        WHEN 'newest'     THEN extract(epoch FROM e.created_at) * -1
        WHEN 'popular'    THEN COALESCE(e.total_attendees, 0) * -1
        WHEN 'price_low'  THEN COALESCE(e.price, 0)
        WHEN 'price_high' THEN COALESCE(e.price, 0) * -1
        ELSE extract(epoch FROM e.start_date)  -- 'soonest' default
      END ASC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 2. get_event_detail ─────────────────────────────────────
-- Returns EVERYTHING for a single event detail page in one call.
-- Replaces: getEventById + isEventLiked + getEventReviews + getEventComments

CREATE OR REPLACE FUNCTION public.get_event_detail(
  p_event_id integer,
  p_viewer_id integer DEFAULT NULL  -- users.id (integer)
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'event', row_to_json(ev),
    'host', host_data,
    'is_liked', COALESCE(like_check.liked, false),
    'user_rsvp_status', rsvp_check.status,
    'ticket_tiers', COALESCE(tiers.data, '[]'::json),
    'attendees', json_build_object(
      'total', COALESCE(ev.total_attendees, 0),
      'avatars', COALESCE(att.avatars, '[]'::json),
      'rsvp_count', COALESCE(att.attendee_count, 0)
    ),
    'review_summary', json_build_object(
      'average', COALESCE(rev_summary.avg_rating, 0),
      'count', COALESCE(rev_summary.review_count, 0)
    ),
    'top_reviews', COALESCE(top_rev.data, '[]'::json),
    'top_comments', COALESCE(top_cmt.data, '[]'::json)
  )
  INTO v_result
  FROM (
    SELECT
      e.id, e.title, e.description, e.start_date, e.end_date,
      e.location, COALESCE(e.cover_image_url, e.image, '') AS image,
      COALESCE(e.images, '[]'::jsonb) AS images,
      e.youtube_video_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.host_id,
      e.location_lat, e.location_lng, e.location_name, e.location_type,
      e.visibility, e.ticketing_enabled, e.category, e.age_restriction,
      e.nsfw, e.share_slug,
      e.dress_code, e.door_policy, e.entry_window, e.lineup, e.perks
    FROM events e
    WHERE e.id = p_event_id
  ) ev
  -- Host
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', u.id,
      'username', u.username,
      'first_name', u.first_name,
      'avatar', COALESCE(m.url, ''),
      'verified', COALESCE(u.verified, false),
      'followers_count', COALESCE(u.followers_count, 0)
    ) AS host_data
    FROM users u
    LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.auth_id = ev.host_id
    LIMIT 1
  ) host_j ON true
  -- Like check
  LEFT JOIN LATERAL (
    SELECT true AS liked
    FROM event_likes el
    WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id
    LIMIT 1
  ) like_check ON p_viewer_id IS NOT NULL
  -- RSVP check
  LEFT JOIN LATERAL (
    SELECT er.status
    FROM event_rsvps er
    WHERE er.event_id = p_event_id
      AND er.user_id = (SELECT auth_id FROM users WHERE id = p_viewer_id LIMIT 1)
    LIMIT 1
  ) rsvp_check ON p_viewer_id IS NOT NULL
  -- Ticket tiers
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', tt.id,
      'name', tt.name,
      'price_cents', tt.price_cents,
      'currency', tt.currency,
      'quantity_total', tt.quantity_total,
      'quantity_sold', tt.quantity_sold,
      'max_per_user', tt.max_per_user,
      'sale_start', tt.sale_start,
      'sale_end', tt.sale_end
    ) ORDER BY tt.price_cents ASC) AS data
    FROM ticket_types tt
    WHERE tt.event_id = p_event_id
  ) tiers ON true
  -- Top attendee avatars (max 8)
  LEFT JOIN LATERAL (
    SELECT
      json_agg(json_build_object(
        'id', au.id,
        'avatar', COALESCE(am.url, ''),
        'username', au.username
      )) AS avatars,
      count(*)::integer AS attendee_count
    FROM (
      SELECT er.user_id AS rsvp_auth_id
      FROM event_rsvps er
      WHERE er.event_id = p_event_id AND er.status = 'going'
      ORDER BY er.created_at DESC
      LIMIT 8
    ) top_rsvps
    LEFT JOIN users au ON au.auth_id = top_rsvps.rsvp_auth_id
    LEFT JOIN media am ON am.id = au.avatar_id
  ) att ON true
  -- Review summary
  LEFT JOIN LATERAL (
    SELECT
      round(avg(r.rating)::numeric, 1)::float AS avg_rating,
      count(*)::integer AS review_count
    FROM event_reviews r
    WHERE r.event_id = p_event_id
  ) rev_summary ON true
  -- Top 3 reviews
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', r.id,
      'rating', r.rating,
      'comment', r.comment,
      'created_at', r.created_at,
      'username', ru.username,
      'avatar', COALESCE(rm.url, '')
    ) ORDER BY r.created_at DESC) AS data
    FROM (
      SELECT * FROM event_reviews
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 3
    ) r
    LEFT JOIN users ru ON ru.id = r.user_id
    LEFT JOIN media rm ON rm.id = ru.avatar_id
  ) top_rev ON true
  -- Top 5 comments
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', c.id,
      'content', c.content,
      'created_at', c.created_at,
      'parent_id', c.parent_id,
      'username', cu.username,
      'avatar', COALESCE(cm.url, '')
    ) ORDER BY c.created_at DESC) AS data
    FROM (
      SELECT * FROM event_comments
      WHERE event_id = p_event_id
      ORDER BY created_at DESC
      LIMIT 5
    ) c
    LEFT JOIN users cu ON cu.id = c.author_id
    LEFT JOIN media cm ON cm.id = cu.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Grants ──────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_events_home(integer, integer, integer, integer, boolean, boolean, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_events_home(integer, integer, integer, integer, boolean, boolean, boolean, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_events_home(integer, integer, integer, integer, boolean, boolean, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO service_role;
