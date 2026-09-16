-- Private access is based on verified JWT identity, not a client profile ID.
-- An RSVP is user-created and therefore never grants private-event access.
CREATE OR REPLACE FUNCTION public.can_view_event(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (
      COALESCE(auth.jwt()->>'role', '') = 'service_role'
      OR COALESCE(e.visibility, 'public') <> 'private'
      OR (auth.jwt()->>'sub' IS NOT NULL AND (
        e.host_id = auth.jwt()->>'sub'
        -- Viewing is not acting. A staff invite is an invitation from the moment
        -- the host sends it, and event_co_organizers has no INSERT policy, so a
        -- pending row is always host-authored and never self-granted. Requiring
        -- accepted = true here would 404 the one screen an invitee has to open
        -- in order to accept. Privileges still require accepted = true; they are
        -- checked where they are used, not here.
        OR EXISTS (SELECT 1 FROM public.event_co_organizers c
          WHERE c.event_id = e.id AND c.user_id = auth.jwt()->>'sub')
        -- status is nullable with default 'pending'; a NULL must read as pending
        -- rather than silently dropping the invitee out of their own guest list.
        OR EXISTS (SELECT 1 FROM public.event_invites i
          WHERE i.event_id = e.id AND i.invited_user_id = auth.jwt()->>'sub'
            AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
        OR EXISTS (SELECT 1 FROM public.tickets t
          WHERE t.event_id = e.id AND t.user_id = auth.jwt()->>'sub'
            AND t.category = 'admission' AND t.status IN ('active', 'scanned'))
      ))
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_event(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_event(integer) TO anon, authenticated, service_role;

-- RESTRICTIVE prevents any older permissive SELECT policy from widening access.
DROP POLICY IF EXISTS events_private_boundary ON public.events;
CREATE POLICY events_private_boundary ON public.events AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (public.can_view_event(id));

-- A direct query to a child table must not expose a private guest list or text.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['event_rsvps', 'event_likes', 'event_comments',
    'event_reviews', 'ticket_types', 'ticket_addons'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS event_private_boundary ON public.%I', v_table);
    EXECUTE format('CREATE POLICY event_private_boundary ON public.%I AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (public.can_view_event(event_id))', v_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id integer, p_viewer_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  -- p_viewer_id is a rendering hint, never an identity credential. Clients
  -- cannot impersonate a host by supplying another user's integer profile ID.
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
      e.status,
      e.cancelled_at,
      e.is_online, e.event_tz,
      e.lynk_room_id
    FROM events e
    WHERE e.id = p_event_id
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
      SELECT merged.uid
      FROM (
        SELECT DISTINCT t.user_id AS uid FROM tickets t
        WHERE t.event_id = p_event_id AND t.status = 'active' AND t.user_id IS NOT NULL
        UNION
        SELECT DISTINCT r.user_id AS uid FROM event_rsvps r
        WHERE r.event_id = p_event_id AND r.status = 'going' AND r.user_id IS NOT NULL
      ) merged
      LEFT JOIN users ua ON ua.auth_id = merged.uid
      ORDER BY (ua.avatar_id IS NOT NULL) DESC, merged.uid
      LIMIT 20
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

-- SECURITY DEFINER projections must enforce the boundary explicitly.
create or replace function public.get_event_attendee_avatars(p_event_id integer)
returns json
language sql
stable
security definer
set search_path = public
as $$
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
    limit 20
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id);
$$;

grant execute on function public.get_event_attendee_avatars(integer) to anon, authenticated, service_role;

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
  WHERE ev.id = p_event_id AND public.can_view_event(p_event_id)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_organizer(integer, integer) TO anon, authenticated, service_role;;

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
  WHERE c.event_id = p_event_id AND public.can_view_event(p_event_id)
    AND c.accepted IS TRUE
    AND c.role IN ('admin', 'editor')
  ORDER BY c.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_event_co_organizers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_co_organizers(integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_event_co_organizers(integer) IS
  'Accepted admin/editor co-organizers of an event, as a public projection: username, display name, avatar, verified, role. No auth_id. Pending invitees and scanners are excluded. Mirrors get_event_organizer so co-hosts are visible wherever the host is.';

CREATE OR REPLACE FUNCTION public.get_spotlight_feed(p_city_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      c.id AS campaign_id,
      c.event_id,
      c.placement,
      c.priority,
      c.starts_at,
      c.ends_at,
      e.title,
      e.description,
      e.start_date,
      e.end_date,
      e.location,
      e.price,
      e.category,
      e.total_attendees,
      COALESCE(e.flyer_image_url, e.cover_image_url, e.image) AS spotlight_image,
      COALESCE(e.cover_image_url, e.image) AS cover_image,
      e.host_id,
      u.username AS host_username,
      av.url AS host_avatar
    FROM event_spotlight_campaigns c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN users u ON u.auth_id = c.organizer_id
    LEFT JOIN media av ON av.id = u.avatar_id
    WHERE c.status = 'active'
      AND COALESCE(e.visibility, 'public') = 'public'
      AND COALESCE(e.status, 'active') <> 'cancelled'
      AND now() BETWEEN c.starts_at AND c.ends_at
      AND c.placement IN ('spotlight', 'spotlight+feed')
      AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
    ORDER BY c.priority DESC, c.ends_at ASC, e.total_attendees DESC
    LIMIT 8
  ) t;
$$;

-- 4b. Promoted event IDs — PUBLIC data (used by feed to flag is_promoted)
CREATE OR REPLACE FUNCTION public.get_promoted_event_ids(p_city_id bigint DEFAULT NULL)
RETURNS TABLE(event_id bigint, campaign_priority int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (c.event_id)
    c.event_id,
    c.priority AS campaign_priority
  FROM event_spotlight_campaigns c
  WHERE c.status = 'active'
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.event_id
      AND COALESCE(e.visibility, 'public') = 'public'
      AND COALESCE(e.status, 'active') <> 'cancelled')
    AND now() BETWEEN c.starts_at AND c.ends_at
    AND c.placement IN ('feed', 'spotlight+feed')
    AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
  ORDER BY c.event_id, c.priority DESC;
$$;


NOTIFY pgrst, 'reload schema';
