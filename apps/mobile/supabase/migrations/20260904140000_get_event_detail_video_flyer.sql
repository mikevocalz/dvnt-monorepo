-- get_event_detail: surface the canonical video-flyer columns
--
-- WHY: the events table has dedicated video_flyer_url / video_poster_url columns
-- (the event create path writes videoFlyerUrl there), but get_event_detail's
-- inner `ev` subquery selected only flyer_image_url + youtube_video_url. So
-- row_to_json(ev) never carried video_flyer_url, the client's
-- resolveFlyerVideoUrl saw nothing, and every event whose flyer lives in the
-- canonical column rendered NO video on the detail hero. Verified before the
-- fix: (get_event_detail(72)->'event') ? 'video_flyer_url' = false.
--
-- CHANGE: add e.video_flyer_url and e.video_poster_url to the `ev` subquery.
-- Nothing else changes — same SECURITY DEFINER mode, same SET search_path, same
-- private-event visibility gate. Two additional public flyer-URL columns inside
-- the already-gated subquery grant no new access.
--
-- VERIFIED (2026-09-04, project npfjanxturvmjyevoyfo):
--   after: get_event_detail(72)->'event'->>'video_flyer_url' returns the .mov URL,
--   get_event_detail(56) returns the .mp4 URL, and other events still resolve.
--   supabase advisors: no new findings (the pre-existing SECURITY DEFINER
--   anon/authenticated-executable WARNs are unrelated and predate this change).
--
-- DOWN: re-run the previous definition (this file's body minus the two added
-- columns). The prior definition is preserved in git history and in
-- scratch/get_event_detail.ORIGINAL.sql from the session that authored this.
--
-- FOLLOW-UP (not in this migration): the event LIST/card RPCs — get_events_home
-- (two overloads) and get_events_for_you — have the same omission, so cards
-- can't autoplay a flyer video yet (they fall back to the poster/image, which
-- is acceptable). Left out here deliberately: editing three overloaded 4KB
-- feed functions is a feed-wide blast radius that warrants its own change +
-- verification pass. Tracked in docs/e2e/bugs.md.

CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id integer, p_viewer_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'event', row_to_json(ev),
    'host', host_j.host_data,
    'is_liked', COALESCE(like_check.liked, false),
    'likes_count', COALESCE(lc.cnt, 0),
    'user_rsvp_status', rsvp_check.status,
    'ticket_tiers', COALESCE(tiers.data, '[]'::json),
    'attendees', json_build_object(
      'total', COALESCE(ev.total_attendees, 0),
      'avatars', COALESCE(att.avatars, '[]'::json),
      'rsvp_count', COALESCE(ev.total_attendees, 0)
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
      e.flyer_image_url, e.video_flyer_url, e.video_poster_url, e.youtube_video_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.host_id,
      e.location_lat, e.location_lng, e.location_name, e.location_type,
      e.visibility, e.ticketing_enabled, e.category, e.age_restriction,
      e.nsfw, e.share_slug,
      e.dress_code, e.door_policy, e.entry_window, e.lineup, e.perks,
      e.status,
      e.cancelled_at,
      e.is_online, e.event_tz
    FROM events e
    WHERE e.id = p_event_id
      AND (
        COALESCE(e.visibility, 'public') != 'private'
        OR p_viewer_id IS NULL
        OR EXISTS (
          SELECT 1 FROM users u WHERE u.id = p_viewer_id AND (
            u.auth_id = e.host_id
            OR EXISTS (SELECT 1 FROM event_rsvps er WHERE er.event_id = e.id AND er.user_id = u.auth_id)
            OR EXISTS (SELECT 1 FROM event_co_organizers eco WHERE eco.event_id = e.id AND eco.user_id = u.auth_id)
            OR EXISTS (SELECT 1 FROM event_invites ei WHERE ei.event_id = e.id AND ei.invited_user_id = u.auth_id)
          )
        )
      )
  ) ev
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', u.id, 'username', u.username, 'first_name', u.first_name,
      'avatar', COALESCE(m.url, ''),
      'verified', COALESCE(u.verified, false),
      'followers_count', COALESCE(u.followers_count, 0)
    ) AS host_data
    FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.auth_id = ev.host_id LIMIT 1
  ) host_j ON true
  LEFT JOIN LATERAL (
    SELECT true AS liked FROM event_likes el
    WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id LIMIT 1
  ) like_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt FROM event_likes el2 WHERE el2.event_id = p_event_id
  ) lc ON true
  LEFT JOIN LATERAL (
    SELECT er.status FROM event_rsvps er
    WHERE er.event_id = p_event_id
      AND er.user_id = (SELECT auth_id FROM users WHERE id = p_viewer_id LIMIT 1)
    LIMIT 1
  ) rsvp_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', tt.id, 'name', tt.name, 'description', tt.description,
      'price_cents', tt.price_cents,
      'quantity_total', tt.quantity_total,
      'quantity_sold', COALESCE(tt.quantity_sold, 0),
      'remaining', CASE WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold, 0)) END,
      'is_sold_out', CASE WHEN tt.quantity_total IS NULL THEN false
        ELSE (COALESCE(tt.quantity_sold, 0) >= tt.quantity_total) END,
      'max_per_order', COALESCE(tt.max_per_user, 4),
      'sale_start', tt.sale_start, 'sale_end', tt.sale_end,
      'perks', tt.perks, 'original_price_cents', tt.original_price_cents,
      'tier', tt.tier, 'glow_color', tt.glow_color, 'is_active', tt.is_active
    ) ORDER BY tt.price_cents ASC) AS data
    FROM ticket_types tt
    WHERE tt.event_id = p_event_id AND tt.is_active = true
  ) tiers ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', u.id::text, 'username', u.username,
      'avatar', COALESCE(m.url, ''), 'image', COALESCE(m.url, ''),
      'initials', COALESCE(upper(left(u.username, 2)), '??')
    )) AS avatars
    FROM (
      SELECT uid FROM (
        SELECT DISTINCT t.user_id AS uid FROM tickets t
        WHERE t.event_id = p_event_id AND t.status = 'active' AND t.user_id IS NOT NULL
        UNION
        SELECT DISTINCT r.user_id AS uid FROM event_rsvps r
        WHERE r.event_id = p_event_id AND r.status = 'going' AND r.user_id IS NOT NULL
      ) merged LIMIT 20
    ) attendees
    JOIN users u ON u.auth_id = attendees.uid
    LEFT JOIN media m ON m.id = u.avatar_id
  ) att ON true
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
           count(*)::integer AS review_count
    FROM event_reviews r WHERE r.event_id = p_event_id
  ) rev_summary ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment,
      'created_at', r.created_at,
      'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
    ) ORDER BY r.created_at DESC) AS data
    FROM (SELECT * FROM event_reviews WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 5) r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_rev ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', c.id, 'content', c.content, 'created_at', c.created_at,
      'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
    ) ORDER BY c.created_at DESC) AS data
    FROM (SELECT * FROM event_comments WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 3) c
    JOIN users u ON u.id = c.author_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$function$;
