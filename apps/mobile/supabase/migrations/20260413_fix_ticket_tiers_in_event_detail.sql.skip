-- Fix get_event_detail: ticket_tiers was missing remaining, is_sold_out, tier,
-- glow_color, description, perks, original_price_cents, max_per_order.
-- Without these the app showed "FREE" for paid events and couldn't select tiers.

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
  -- Ticket tiers — all fields needed by the client
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
      SELECT DISTINCT er2.user_id
      FROM event_rsvps er2
      WHERE er2.event_id = p_event_id AND er2.status = 'going'
      LIMIT 8
    ) rsvp_users
    LEFT JOIN users au ON au.auth_id = rsvp_users.user_id
    LEFT JOIN media am ON am.id = au.avatar_id
  ) att ON true
  -- Review summary
  LEFT JOIN LATERAL (
    SELECT
      AVG(r.rating)::numeric(3,1) AS avg_rating,
      COUNT(*)::integer AS review_count
    FROM event_reviews r
    WHERE r.event_id = p_event_id
  ) rev_summary ON true
  -- Top reviews (max 3)
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
  -- Top comments (max 5)
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
    FROM (SELECT * FROM post_comments WHERE post_id = p_event_id ORDER BY created_at DESC LIMIT 5) c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO authenticated, anon, service_role;
