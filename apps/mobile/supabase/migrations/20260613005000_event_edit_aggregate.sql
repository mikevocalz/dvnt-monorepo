-- ════════════════════════════════════════════════════════════════════════
-- Edit-completeness (prompt Phase 5.5.2) — ONE endpoint returning the full event
-- aggregate (event + flyer + tiers + add-ons(+variants) + active boost) so the
-- edit form hydrates from server, never a partial list-view cache (the #1 source
-- of "blank field after save"). Mirrors lib/contracts/event-edit-fields.ts.
-- Read-only / STABLE. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_event_edit_aggregate(p_event_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'event', (
      SELECT jsonb_build_object(
        'id', e.id, 'title', e.title, 'description', e.description,
        'date', e.date, 'start_date', e.start_date, 'end_date', e.end_date,
        'location', e.location, 'category', e.category, 'visibility', e.visibility,
        'max_attendees', e.max_attendees, 'status', e.status,
        'age_restriction', e.age_restriction, 'youtube_video_url', e.youtube_video_url
      ) FROM public.events e WHERE e.id = p_event_id
    ),
    'flyer', (
      SELECT jsonb_build_object(
        'video_flyer_url', e.video_flyer_url, 'video_poster_url', e.video_poster_url,
        'flyer_image_url', e.flyer_image_url, 'cover_image_url', e.cover_image_url,
        'image', e.image, 'dominant_color', e.dominant_color, 'flyer_image_meta', e.flyer_image_meta
      ) FROM public.events e WHERE e.id = p_event_id
    ),
    'tiers', COALESCE((
      SELECT jsonb_agg(to_jsonb(tt.*) ORDER BY tt.sort_order, tt.id)
      FROM public.ticket_types tt WHERE tt.event_id = p_event_id
    ), '[]'::jsonb),
    'addons', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(a.*) || jsonb_build_object('variants', COALESCE((
          SELECT jsonb_agg(to_jsonb(v.*) ORDER BY v.sort_order, v.id)
          FROM public.ticket_addon_variants v WHERE v.addon_id = a.id
        ), '[]'::jsonb))
        ORDER BY a.sort_order, a.id
      )
      FROM public.ticket_addons a WHERE a.event_id = p_event_id
    ), '[]'::jsonb),
    'boost', (
      SELECT to_jsonb(c.*)
      FROM public.event_spotlight_campaigns c
      WHERE c.event_id = p_event_id AND c.status IN ('pending_payment','active','paused')
      ORDER BY c.created_at DESC LIMIT 1
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_event_edit_aggregate(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.get_event_edit_aggregate(bigint) TO service_role, authenticated;
