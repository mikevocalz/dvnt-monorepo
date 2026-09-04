-- Event LIST/card RPCs: surface the canonical video-flyer columns
--
-- Companion to 20260904140000 (which fixed get_event_detail). The three feed
-- functions that build event cards — get_events_for_you and both get_events_home
-- overloads — selected only flyer_image_url in their row_to_json subquery, so
-- event CARDS could never carry a flyer video (they fell back to the poster
-- image). Same one-line omission as the detail RPC.
--
-- CHANGE: add e.video_flyer_url + e.video_poster_url to each function's SELECT.
-- Nothing else changes — same STABLE SECURITY DEFINER mode, same SET search_path,
-- same public-visibility filters. Two public flyer-URL columns, no new access.
--
-- VERIFIED (2026-09-04, project npfjanxturvmjyevoyfo):
--   - get_events_for_you(viewer,50,0) returns events 56 & 72 with video_flyer_url
--     present.
--   - all four event RPCs report has_vfu_col = true.
--   - supabase advisors: no new findings (the pre-existing SECURITY DEFINER WARNs
--     are unrelated and predate this change).
--
-- NOTE (pre-existing, NOT introduced here): the two get_events_home overloads
-- are ambiguous for a 10-argument call (the 11-arg overload defaults p_nsfw).
-- That overload overlap predates this migration; both were updated identically
-- so behaviour is unchanged whichever the planner resolves.
--
-- DOWN: re-run each function's prior definition (this file minus the two added
-- columns); prior definitions are in git history.

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
        + CASE WHEN e.start_date < now() THEN -100 ELSE 0 END
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
    ORDER BY score DESC, e.start_date ASC
    LIMIT p_limit
    OFFSET p_offset
  ) scored;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_home(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_viewer_id integer DEFAULT NULL::integer, p_city_id integer DEFAULT NULL::integer, p_filter_online boolean DEFAULT NULL::boolean, p_filter_tonight boolean DEFAULT false, p_filter_weekend boolean DEFAULT false, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'soonest'::text, p_nsfw boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      e.flyer_image_url,
      e.video_flyer_url,
      e.video_poster_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.category::text, e.visibility, e.location_type,
      e.age_restriction, e.ticketing_enabled, e.share_slug,
      COALESCE(e.nsfw, false) AS nsfw,
      e.status,
      e.cancelled_at,
      host_data.username  AS host_username,
      host_data.avatar_url AS host_avatar,
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0)   AS rsvp_count,
      CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
           THEN true ELSE false END AS is_liked,
      COALESCE(lc.cnt, 0) AS likes_count
    FROM events e
    LEFT JOIN LATERAL (
      SELECT u.username, m.url AS avatar_url, ba.name AS host_name
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
      AND COALESCE(e.end_date, e.start_date + interval '6 hours') >= now() - interval '24 hours'
      AND COALESCE(e.visibility, 'public') = 'public'
      AND (p_nsfw IS NULL OR COALESCE(e.nsfw, false) = p_nsfw)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_events_home(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_viewer_id integer DEFAULT NULL::integer, p_city_id integer DEFAULT NULL::integer, p_filter_online boolean DEFAULT NULL::boolean, p_filter_tonight boolean DEFAULT false, p_filter_weekend boolean DEFAULT false, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'soonest'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
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
      e.flyer_image_url,
      e.video_flyer_url,
      e.video_poster_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.category, e.visibility, e.location_type,
      e.age_restriction, e.ticketing_enabled, e.share_slug,
      e.status,
      e.cancelled_at,
      host_data.username AS host_username,
      host_data.avatar_url AS host_avatar,
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0) AS rsvp_count,
      CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
           THEN true ELSE false END AS is_liked,
      COALESCE(lc.cnt, 0) AS likes_count
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
    LEFT JOIN event_likes el
      ON el.event_id = e.id AND el.user_id = p_viewer_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
      FROM event_likes el2
      WHERE el2.event_id = e.id
    ) lc ON true
    WHERE e.start_date IS NOT NULL
      AND COALESCE(e.visibility, 'public') = 'public'
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
        ELSE extract(epoch FROM e.start_date)
      END ASC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;
