-- Fix 1: Add likes_count to get_event_detail RPC.
-- The client was hardcoding likes: 0 because the RPC never returned a count.
-- Also adds likes_count to the JSON so onSuccess cache sync works correctly.

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
    'likes_count', COALESCE(lc.cnt, 0),
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
      e.flyer_image_url,
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
  -- Like check (viewer-specific)
  LEFT JOIN LATERAL (
    SELECT true AS liked
    FROM event_likes el
    WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id
    LIMIT 1
  ) like_check ON p_viewer_id IS NOT NULL
  -- Total likes count (public)
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM event_likes el2
    WHERE el2.event_id = p_event_id
  ) lc ON true
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
      'description', tt.description,
      'price_cents', tt.price_cents,
      'quantity_total', tt.quantity_total,
      'quantity_sold', COALESCE(tt.quantity_sold, 0),
      'remaining', CASE
        WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold, 0))
      END,
      'is_sold_out', CASE
        WHEN tt.quantity_total IS NULL THEN false
        ELSE (COALESCE(tt.quantity_sold, 0) >= tt.quantity_total)
      END,
      'max_per_order', COALESCE(tt.max_per_user, 4),
      'sale_start', tt.sale_start,
      'sale_end', tt.sale_end,
      'perks', tt.perks,
      'original_price_cents', tt.original_price_cents,
      'tier', tt.tier,
      'glow_color', tt.glow_color,
      'is_active', tt.is_active
    ) ORDER BY tt.price_cents ASC) AS data
    FROM ticket_types tt
    WHERE tt.event_id = p_event_id
      AND tt.is_active = true
  ) tiers ON true
  -- Attendee avatars (from tickets + RSVPs)
  LEFT JOIN LATERAL (
    SELECT
      json_agg(json_build_object(
        'image', COALESCE(m.url, ''),
        'initials', COALESCE(upper(left(u.username, 2)), '??')
      )) AS avatars,
      count(*)::integer AS attendee_count
    FROM (
      SELECT DISTINCT t.user_id AS uid
      FROM tickets t
      WHERE t.event_id = p_event_id AND t.status = 'active' AND t.user_id IS NOT NULL
      LIMIT 20
    ) buyers
    JOIN users u ON u.auth_id = buyers.uid
    LEFT JOIN media m ON m.id = u.avatar_id
  ) att ON true
  -- Review summary
  LEFT JOIN LATERAL (
    SELECT
      ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
      count(*)::integer AS review_count
    FROM event_reviews r
    WHERE r.event_id = p_event_id
  ) rev_summary ON true
  -- Top reviews (3 most recent)
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', r.id,
      'rating', r.rating,
      'comment', r.comment,
      'created_at', r.created_at,
      'author', json_build_object(
        'username', u.username,
        'avatar', COALESCE(m.url, '')
      )
    ) ORDER BY r.created_at DESC) AS data
    FROM (SELECT * FROM event_reviews WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 3) r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_rev ON true
  -- Top comments
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', c.id,
      'content', c.content,
      'created_at', c.created_at,
      'author', json_build_object(
        'username', u.username,
        'avatar', COALESCE(m.url, '')
      )
    ) ORDER BY c.created_at DESC) AS data
    FROM (SELECT * FROM event_comments WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 5) c
    JOIN users u ON u.id = c.author_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_event_detail(integer, integer) TO authenticated, anon, service_role;


-- Fix 2: Trigger to keep events.total_attendees in sync with tickets table.
-- Previously, purchasing a ticket never updated total_attendees, so all
-- events showed 0 attendees even after purchases.

CREATE OR REPLACE FUNCTION public.maintain_event_total_attendees()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN
      UPDATE events
        SET total_attendees = COALESCE(total_attendees, 0) + 1
        WHERE id = NEW.event_id;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'active' AND NEW.status <> 'active' THEN
      -- Ticket cancelled / refunded / voided
      UPDATE events
        SET total_attendees = GREATEST(COALESCE(total_attendees, 0) - 1, 0)
        WHERE id = NEW.event_id;
    ELSIF OLD.status <> 'active' AND NEW.status = 'active' THEN
      -- Ticket reactivated
      UPDATE events
        SET total_attendees = COALESCE(total_attendees, 0) + 1
        WHERE id = NEW.event_id;
    END IF;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN
      UPDATE events
        SET total_attendees = GREATEST(COALESCE(total_attendees, 0) - 1, 0)
        WHERE id = OLD.event_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_maintain_event_total_attendees ON public.tickets;

CREATE TRIGGER trg_maintain_event_total_attendees
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.maintain_event_total_attendees();

-- Backfill: sync total_attendees from actual active ticket counts for all events.
-- This fixes events that already have sold tickets but show 0 attendees.
UPDATE events e
SET total_attendees = (
  SELECT count(*)::integer
  FROM tickets t
  WHERE t.event_id = e.id AND t.status = 'active'
)
WHERE EXISTS (
  SELECT 1 FROM tickets t WHERE t.event_id = e.id AND t.status = 'active'
);
