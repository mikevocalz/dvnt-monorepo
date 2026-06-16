-- ════════════════════════════════════════════════════════════════════════
-- Edit-completeness SAVE (prompt Phase 5.5.3) — complete-diff, NOT a partial
-- patch. A field absent from the payload = "no change"; an explicit JSON null =
-- "clear". Achieved with the merged-record pattern: overlay the payload onto the
-- current row's jsonb, then jsonb_populate_record casts every field (incl. the
-- `category` enum) back to its column type. The capacity-below-sold trigger
-- still guards max_attendees. Pairs with get_event_edit_aggregate (read).
-- Tier/add-on upsert follows the same per-row pattern (next pass).
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_event_aggregate(p_event_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur jsonb;
  v_merged jsonb;
  v_rec public.events;
BEGIN
  SELECT to_jsonb(e) INTO v_cur FROM public.events e WHERE e.id = p_event_id;
  IF v_cur IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;

  -- Overlay event + flyer payload keys onto the current row. `||` keeps omitted
  -- keys (from v_cur) and applies present keys (incl. explicit null = clear).
  v_merged := v_cur
    || COALESCE(p_payload->'event', '{}'::jsonb)
    || COALESCE(p_payload->'flyer', '{}'::jsonb);

  v_rec := jsonb_populate_record(NULL::public.events, v_merged);

  UPDATE public.events SET
    title             = v_rec.title,
    description       = v_rec.description,
    date              = v_rec.date,
    start_date        = v_rec.start_date,
    end_date          = v_rec.end_date,
    location          = v_rec.location,
    category          = v_rec.category,
    visibility        = v_rec.visibility,
    max_attendees     = v_rec.max_attendees,   -- guarded by trg_event_capacity_guard
    status            = v_rec.status,
    age_restriction   = v_rec.age_restriction,
    youtube_video_url = v_rec.youtube_video_url,
    video_flyer_url   = v_rec.video_flyer_url,
    video_poster_url  = v_rec.video_poster_url,
    flyer_image_url   = v_rec.flyer_image_url,
    cover_image_url   = v_rec.cover_image_url,
    image             = v_rec.image,
    dominant_color    = v_rec.dominant_color,
    flyer_image_meta  = v_rec.flyer_image_meta
  WHERE id = p_event_id;

  RETURN jsonb_build_object('ok', true, 'eventId', p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.save_event_aggregate(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.save_event_aggregate(bigint, jsonb) TO service_role;
