-- ════════════════════════════════════════════════════════════════════════
-- Guest ticket view + delivery idempotency (prompt 4.5.4 / 5.6.4, DB half).
--   • orders.email_sent_at / sms_sent_at — per-channel delivery stamps so a
--     stripe-webhook replay never double-sends (the edge fn only sends if null).
--   • get_guest_ticket_view(token) — resolves a ticket's unguessable
--     guest_lookup_token → the ticket + LIVE event snapshot (Phase-2: reflects
--     organizer edits) + its add-ons, with no login and no PII beyond the
--     ticket. SECURITY DEFINER (token is the capability; bypasses RLS).
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_guest_lookup_token
  ON public.tickets(guest_lookup_token) WHERE guest_lookup_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_guest_ticket_view(p_token text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', t.id,
      'status', t.status,
      'order_index', t.order_index,
      'order_count', t.order_count,
      'attendee_name', t.attendee_name,
      'category', t.category,
      'tier', tt.tier_type, 'tier_name', tt.name,
      'qr_payload', t.qr_payload          -- the door scans this; HMAC-validated server-side
    ),
    'event', (
      -- LIVE snapshot — a time/venue edit reflects on the guest's already-sent ticket
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'date', e.date, 'start_date', e.start_date,
        'location', e.location, 'status', e.status,
        'video_flyer_url', e.video_flyer_url, 'video_poster_url', e.video_poster_url,
        'flyer_image_url', e.flyer_image_url, 'cover_image_url', e.cover_image_url,
        'image', e.image, 'dominant_color', e.dominant_color
      ) FROM public.events e WHERE e.id = t.event_id
    ),
    'addons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oa.id, 'name', a.name, 'status', oa.status, 'quantity', oa.quantity, 'qr_payload', oa.qr_payload))
      FROM public.order_addons oa JOIN public.ticket_addons a ON a.id = oa.addon_id
      WHERE oa.ticket_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.tickets t
  LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.guest_lookup_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_guest_ticket_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_guest_ticket_view(text) TO service_role, anon, authenticated;

COMMENT ON FUNCTION public.get_guest_ticket_view(text) IS
  'Capability-token guest ticket view. Possession of the unguessable token grants read of one ticket + live event snapshot. No login. Used by the get-guest-ticket edge fn + /t/{token} web view.';
