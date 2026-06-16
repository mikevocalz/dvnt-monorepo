-- ============================================================
-- "For You" Event Scoring RPC
-- Scores events for a specific user based on:
--   1. Social signal (friends going / people they follow attending)
--   2. Category affinity (categories of events they've liked/RSVP'd)
--   3. Recency (newer events score higher)
--   4. Popularity (attendee count)
-- Results cached client-side for 15 minutes via staleTime.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_events_for_you(
  p_viewer_id  integer,          -- users.id (integer)
  p_limit      integer DEFAULT 20,
  p_offset     integer DEFAULT 0
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_viewer_auth_id text;
BEGIN
  -- Resolve viewer auth_id for follow/RSVP joins
  SELECT auth_id INTO v_viewer_auth_id
  FROM users WHERE id = p_viewer_id;

  IF v_viewer_auth_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(row_to_json(scored))
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
      -- Host info
      host_data.username AS host_username,
      host_data.avatar_url AS host_avatar,
      -- Attendee avatars
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0) AS rsvp_count,
      -- Like status
      CASE WHEN el.id IS NOT NULL THEN true ELSE false END AS is_liked,
      -- Friends going count
      COALESCE(friends.cnt, 0) AS friends_going,
      -- Scoring components (for debugging / tuning)
      (
        -- Social: 10 points per friend going (max 50)
        LEAST(COALESCE(friends.cnt, 0) * 10, 50)
        -- Category affinity: 15 points if user has liked/RSVP'd same category
        + CASE WHEN cat_affinity.match THEN 15 ELSE 0 END
        -- Popularity: log-scaled attendee count (max 20)
        + LEAST(COALESCE(ln(GREATEST(e.total_attendees, 1) + 1) * 5, 0)::integer, 20)
        -- Recency: events created in last 48h get 10 bonus points
        + CASE WHEN e.created_at > now() - interval '48 hours' THEN 10 ELSE 0 END
        -- Upcoming soon: events in next 7 days get 15 points
        + CASE WHEN e.start_date BETWEEN now() AND now() + interval '7 days' THEN 15 ELSE 0 END
        -- Penalty: past events get -100
        + CASE WHEN e.start_date < now() THEN -100 ELSE 0 END
      ) AS score
    FROM events e
    -- Host
    LEFT JOIN LATERAL (
      SELECT u.username, m.url AS avatar_url
      FROM users u
      LEFT JOIN media m ON m.id = u.avatar_id
      WHERE u.auth_id = e.host_id
      LIMIT 1
    ) host_data ON true
    -- Attendee avatars (top 5)
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
    -- Like check
    LEFT JOIN event_likes el ON el.event_id = e.id AND el.user_id = p_viewer_id
    -- Friends going (people the viewer follows who RSVP'd)
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
      FROM event_rsvps er
      INNER JOIN follows f ON f.following_id = (
        SELECT u2.id FROM users u2 WHERE u2.auth_id = er.user_id LIMIT 1
      )
      WHERE er.event_id = e.id
        AND er.status = 'going'
        AND f.follower_id = p_viewer_id
    ) friends ON true
    -- Category affinity: has user liked or RSVP'd events in this category?
    LEFT JOIN LATERAL (
      SELECT EXISTS (
        SELECT 1 FROM event_likes el2
        INNER JOIN events e2 ON e2.id = el2.event_id
        WHERE el2.user_id = p_viewer_id
          AND e2.category = e.category
          AND e.category IS NOT NULL
        LIMIT 1
      ) OR EXISTS (
        SELECT 1 FROM event_rsvps er2
        INNER JOIN events e2 ON e2.id = er2.event_id
        WHERE er2.user_id = v_viewer_auth_id
          AND er2.status = 'going'
          AND e2.category = e.category
          AND e.category IS NOT NULL
        LIMIT 1
      ) AS match
    ) cat_affinity ON true
    WHERE e.start_date IS NOT NULL
    ORDER BY score DESC, e.start_date ASC
    LIMIT p_limit
    OFFSET p_offset
  ) scored;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- Grants
GRANT EXECUTE ON FUNCTION public.get_events_for_you(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_events_for_you(integer, integer, integer) TO service_role;
