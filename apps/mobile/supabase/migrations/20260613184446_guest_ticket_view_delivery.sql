-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613184446 :: guest_ticket_view_delivery). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_guest_lookup_token
  ON public.tickets(guest_lookup_token) WHERE guest_lookup_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_guest_ticket_view(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'ticket', jsonb_build_object(
      'id', t.id, 'status', t.status, 'order_index', t.order_index, 'order_count', t.order_count,
      'attendee_name', t.attendee_name, 'category', t.category,
      'tier', tt.tier_type, 'tier_name', tt.name, 'qr_payload', t.qr_payload),
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'date', e.date, 'start_date', e.start_date,
        'location', e.location, 'status', e.status,
        'video_flyer_url', e.video_flyer_url, 'video_poster_url', e.video_poster_url,
        'flyer_image_url', e.flyer_image_url, 'cover_image_url', e.cover_image_url,
        'image', e.image, 'dominant_color', e.dominant_color
      ) FROM public.events e WHERE e.id = t.event_id),
    'addons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', oa.id, 'name', a.name, 'status', oa.status, 'quantity', oa.quantity, 'qr_payload', oa.qr_payload))
      FROM public.order_addons oa JOIN public.ticket_addons a ON a.id = oa.addon_id
      WHERE oa.ticket_id = t.id), '[]'::jsonb)
  )
  FROM public.tickets t
  LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
  WHERE t.guest_lookup_token = p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_guest_ticket_view(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_guest_ticket_view(text) TO service_role, anon, authenticated;;
