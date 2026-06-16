-- ============================================================
-- Two visibility hardening fixes:
--
-- Fix 1 — get_event_detail: private events now require the
--   viewer to be the host or to have an RSVP. link_only and
--   public remain open-access (link_only is meant to be
--   accessible to anyone who received the share link, which
--   implies they already have the event ID).
--
-- Fix 2 — get_spotlight_feed / get_promoted_event_ids: add
--   COALESCE(e.visibility,'public') = 'public' so a host
--   cannot pay to insert a private or link_only event into
--   the public discovery carousel or feed promoted slots.
-- ============================================================


-- ── Fix 1: get_event_detail ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_detail(
  p_event_id integer,
  p_viewer_id integer DEFAULT NULL
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
      -- private events: viewer must be the host or have an RSVP.
      -- link_only and public are open to anyone with the ID.
      AND (
        COALESCE(e.visibility, 'public') != 'private'
        OR EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = p_viewer_id
            AND (
              u.auth_id = e.host_id
              OR EXISTS (
                SELECT 1 FROM event_rsvps er
                WHERE er.event_id = e.id AND er.user_id = u.auth_id
              )
            )
        )
      )
  ) ev
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
  LEFT JOIN LATERAL (
    SELECT true AS liked
    FROM event_likes el
    WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id
    LIMIT 1
  ) like_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT er.status
    FROM event_rsvps er
    WHERE er.event_id = p_event_id
      AND er.user_id = (SELECT auth_id FROM users WHERE id = p_viewer_id LIMIT 1)
    LIMIT 1
  ) rsvp_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', tt.id,
      'name', tt.name,
      'description', tt.description,
      'price_cents', tt.price_cents,
      'original_price_cents', tt.original_price_cents,
      'currency', COALESCE(tt.currency, 'usd'),
      'quantity_total', tt.quantity_total,
      'quantity_sold', tt.quantity_sold,
      'remaining', GREATEST(0, COALESCE(tt.quantity_total, 9999) - COALESCE(tt.quantity_sold, 0)),
      'is_sold_out', COALESCE(tt.is_sold_out, false) OR (tt.quantity_total IS NOT NULL AND GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold, 0)) = 0),
      'max_per_order', COALESCE(tt.max_per_order, tt.max_per_user, 4),
      'tier', COALESCE(tt.tier, 'ga'),
      'glow_color', tt.glow_color,
      'perks', COALESCE(tt.perks, '[]'::jsonb),
      'sale_start', tt.sale_start,
      'sale_end', tt.sale_end
    ) ORDER BY tt.price_cents ASC) AS data
    FROM ticket_types tt
    WHERE tt.event_id = p_event_id
      AND (tt.is_active IS NULL OR tt.is_active = true)
  ) tiers ON true
  LEFT JOIN LATERAL (
    SELECT
      json_agg(json_build_object(
        'id', au.id,
        'avatar', COALESCE(am.url, ''),
        'username', au.username
      )) AS avatars,
      count(*)::integer AS attendee_count
    FROM (
      SELECT DISTINCT er2.user_id
      FROM event_rsvps er2
      WHERE er2.event_id = p_event_id AND er2.status = 'going'
      LIMIT 8
    ) rsvp_users
    LEFT JOIN users au ON au.auth_id = rsvp_users.user_id
    LEFT JOIN media am ON am.id = au.avatar_id
  ) att ON true
  LEFT JOIN LATERAL (
    SELECT
      AVG(r.rating)::numeric(3,1) AS avg_rating,
      COUNT(*)::integer AS review_count
    FROM event_reviews r
    WHERE r.event_id = p_event_id
  ) rev_summary ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', r.id,
      'rating', r.rating,
      'comment', r.comment,
      'created_at', r.created_at,
      'user', json_build_object(
        'id', u.id,
        'username', u.username,
        'avatar', COALESCE(m.url, '')
      )
    ) ORDER BY r.created_at DESC) AS data
    FROM (SELECT * FROM event_reviews WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 3) r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_rev ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', c.id,
      'content', c.content,
      'created_at', c.created_at,
      'user', json_build_object(
        'id', u.id,
        'username', u.username,
        'avatar', COALESCE(m.url, '')
      )
    ) ORDER BY c.created_at DESC) AS data
    FROM (SELECT * FROM event_comments WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 5) c
    LEFT JOIN users u ON u.id = c.author_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO authenticated, anon, service_role;


-- ── Fix 2a: get_spotlight_feed — require public visibility ───
CREATE OR REPLACE FUNCTION get_spotlight_feed(p_city_id bigint DEFAULT NULL)
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
      AND now() BETWEEN c.starts_at AND c.ends_at
      AND c.placement IN ('spotlight', 'spotlight+feed')
      AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
      AND COALESCE(e.visibility, 'public') = 'public'
    ORDER BY c.priority DESC, c.ends_at ASC, e.total_attendees DESC
    LIMIT 8
  ) t;
$$;


-- ── Fix 2b: get_promoted_event_ids — require public visibility
CREATE OR REPLACE FUNCTION get_promoted_event_ids(p_city_id bigint DEFAULT NULL)
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
  JOIN events e ON e.id = c.event_id
  WHERE c.status = 'active'
    AND now() BETWEEN c.starts_at AND c.ends_at
    AND c.placement IN ('feed', 'spotlight+feed')
    AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
    AND COALESCE(e.visibility, 'public') = 'public'
  ORDER BY c.event_id, c.priority DESC;
$$;

-- Grants unchanged
GRANT EXECUTE ON FUNCTION get_spotlight_feed TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_promoted_event_ids TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
