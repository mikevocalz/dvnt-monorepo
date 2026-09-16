-- The guest list belongs to the people in the room.
--
-- Until now the attendee list was gated on can_view_event: anyone who could
-- open the event — which on a link_only event means anyone holding the link —
-- got up to 20 attendee avatars from get_event_detail. The client tried to make
-- up the difference by not rendering them for private and link_only events,
-- which hid the guest list from the host and from the people actually going
-- while still shipping it over the wire to everyone else.
--
-- Attending means: the host, an accepted co-organizer, a 'going' RSVP, or a
-- live ticket. The viewer comes from the JWT, never from a parameter.
CREATE OR REPLACE FUNCTION public.viewer_is_attending(p_event_id integer)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    WHEN auth.jwt() ->> 'sub' IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND e.host_id = auth.jwt() ->> 'sub'
    ) OR EXISTS (
      SELECT 1 FROM public.event_co_organizers c
      WHERE c.event_id = p_event_id AND c.user_id = auth.jwt() ->> 'sub'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvps r
      WHERE r.event_id = p_event_id AND r.user_id = auth.jwt() ->> 'sub'
        AND r.status = 'going'
    ) OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.event_id = p_event_id AND t.user_id = auth.jwt() ->> 'sub'
        AND t.status IN ('active', 'scanned')
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.viewer_is_attending(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.viewer_is_attending(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_attendee_avatars(p_event_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'id', au.id::text, 'username', au.username,
    'avatar', coalesce(am.url, ''), 'image', coalesce(am.url, ''),
    'initials', coalesce(upper(left(au.username, 2)), '??')
  ) order by (am.url is not null) desc), '[]'::json)
  from (
    select merged.uid from (
      select distinct t.user_id as uid from tickets t
      where t.event_id = p_event_id and t.status = 'active' and t.user_id is not null
      union
      select distinct r.user_id as uid from event_rsvps r
      where r.event_id = p_event_id and r.status = 'going' and r.user_id is not null
    ) merged
    left join users ua on ua.auth_id = merged.uid
    order by (ua.avatar_id is not null) desc, merged.uid
    limit 20
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id)
    and public.viewer_is_attending(p_event_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_event_attendee_page(p_event_id integer, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'id', au.id::text,
    'username', au.username,
    'avatar', coalesce(am.url, ''),
    'image', coalesce(am.url, ''),
    'initials', coalesce(upper(left(au.username, 2)), '??')
  ) order by (am.url is not null) desc), '[]'::json)
  from (
    select merged.uid
    from (
      select distinct t.user_id as uid from tickets t
      where t.event_id = p_event_id and t.status = 'active' and t.user_id is not null
      union
      select distinct r.user_id as uid from event_rsvps r
      where r.event_id = p_event_id and r.status = 'going' and r.user_id is not null
    ) merged
    left join users ua on ua.auth_id = merged.uid
    order by (ua.avatar_id is not null) desc, merged.uid
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id)
    and public.viewer_is_attending(p_event_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id integer, p_viewer_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    SELECT id INTO p_viewer_id FROM public.users
    WHERE auth_id = auth.jwt()->>'sub' LIMIT 1;
  END IF;
  IF NOT public.can_view_event(p_event_id) THEN RETURN NULL; END IF;
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
      e.status, e.cancelled_at, e.is_online, e.event_tz, e.lynk_room_id
    FROM events e WHERE e.id = p_event_id
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
    -- The guest list belongs to the people in the room. One source of truth:
    -- get_event_attendee_avatars() answers '[]' to anyone who is not going.
    SELECT public.get_event_attendee_avatars(p_event_id) AS avatars
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
