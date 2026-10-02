-- For You scoring: a live event is not a dead event.
--
-- BUG: the −100 penalty fired on `e.start_date < now()`, so an event that
-- had already started was buried mid-run — and since events.end_date is
-- NULL on most rows, every one of them dropped out of recommendations
-- the moment doors opened. The dead-event test now uses the same
-- coalesced end as get_events_home:
--   COALESCE(e.end_date, e.start_date + interval '6 hours') < now()
--
-- This file is 20260916190000's get_events_for_you verbatim plus that
-- one CASE arm. Same STABLE SECURITY DEFINER, same SET search_path,
-- same columns.
--
-- DOWN: re-run the get_events_for_you block from
-- 20260916190000_exclude_cancelled_events_from_discovery.sql.

CREATE OR REPLACE FUNCTION public.get_events_for_you(p_viewer_id integer, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_viewer_auth_id text;
BEGIN
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
      e.flyer_image_url,
      e.video_flyer_url,
      e.video_poster_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees,
      e.category,
      e.visibility,
      e.location_type,
      e.age_restriction,
      e.ticketing_enabled,
      e.share_slug,
      e.status,
      e.cancelled_at,
      host_data.username AS host_username,
      host_data.avatar_url AS host_avatar,
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0) AS rsvp_count,
      CASE WHEN el.id IS NOT NULL THEN true ELSE false END AS is_liked,
      COALESCE(lc.cnt, 0) AS likes_count,
      COALESCE(friends.cnt, 0) AS friends_going,
      (
        LEAST(COALESCE(friends.cnt, 0) * 10, 50)
        + CASE WHEN cat_affinity.match THEN 15 ELSE 0 END
        + LEAST(COALESCE(ln(GREATEST(e.total_attendees, 1) + 1) * 5, 0)::integer, 20)
        + CASE WHEN e.created_at > now() - interval '48 hours' THEN 10 ELSE 0 END
        + CASE WHEN e.start_date BETWEEN now() AND now() + interval '7 days' THEN 15 ELSE 0 END
        + CASE WHEN COALESCE(e.end_date, e.start_date + interval '6 hours') < now() THEN -100 ELSE 0 END
      ) AS score
    FROM events e
    LEFT JOIN LATERAL (
      SELECT u.username, m.url AS avatar_url
      FROM users u
      LEFT JOIN media m ON m.id = u.avatar_id
      WHERE u.auth_id = e.host_id
      LIMIT 1
    ) host_data ON true
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
    LEFT JOIN event_likes el ON el.event_id = e.id AND el.user_id = p_viewer_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
      FROM event_likes el2
      WHERE el2.event_id = e.id
    ) lc ON true
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
      AND COALESCE(e.visibility, 'public') = 'public'
      AND COALESCE(e.status, 'active') NOT IN ('cancelled', 'canceled', 'draft', 'suspended')
    ORDER BY score DESC, e.start_date ASC
    LIMIT p_limit
    OFFSET p_offset
  ) scored;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

NOTIFY pgrst, 'reload schema';
