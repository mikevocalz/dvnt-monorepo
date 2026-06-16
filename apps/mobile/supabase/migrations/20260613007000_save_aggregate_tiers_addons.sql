-- ════════════════════════════════════════════════════════════════════════
-- Extend save_event_aggregate (20260613006000) to upsert TIERS + ADD-ONS(+variants)
-- via the same merged-record complete-diff: existing rows (matched by id) keep
-- omitted fields and only change what the payload sends; new rows (no matching id)
-- are inserted with event/addon parentage. Inventory counters (quantity_sold/held)
-- are server-managed and never overwritten. No silent deletes (removing a tier with
-- sold tickets is an explicit action, not an edit side-effect). Idempotent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.save_event_aggregate(p_event_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cur jsonb; v_merged jsonb; v_rec public.events;
  v_t jsonb; v_a jsonb; v_v jsonb;
  v_tier public.ticket_types; v_addon public.ticket_addons; v_variant public.ticket_addon_variants;
  v_exist jsonb; v_id uuid; v_addon_id uuid;
  v_tiers_upserted int := 0; v_addons_upserted int := 0; v_variants_upserted int := 0;
BEGIN
  SELECT to_jsonb(e) INTO v_cur FROM public.events e WHERE e.id = p_event_id;
  IF v_cur IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;

  -- ── event + flyer (complete-diff) ──
  v_merged := v_cur || COALESCE(p_payload->'event', '{}'::jsonb) || COALESCE(p_payload->'flyer', '{}'::jsonb);
  v_rec := jsonb_populate_record(NULL::public.events, v_merged);
  UPDATE public.events SET
    title=v_rec.title, description=v_rec.description, date=v_rec.date, start_date=v_rec.start_date,
    end_date=v_rec.end_date, location=v_rec.location, category=v_rec.category, visibility=v_rec.visibility,
    max_attendees=v_rec.max_attendees, status=v_rec.status, age_restriction=v_rec.age_restriction,
    youtube_video_url=v_rec.youtube_video_url, video_flyer_url=v_rec.video_flyer_url,
    video_poster_url=v_rec.video_poster_url, flyer_image_url=v_rec.flyer_image_url,
    cover_image_url=v_rec.cover_image_url, image=v_rec.image, dominant_color=v_rec.dominant_color,
    flyer_image_meta=v_rec.flyer_image_meta
  WHERE id = p_event_id;

  -- ── tiers (upsert by id) ──
  IF jsonb_typeof(p_payload->'tiers') = 'array' THEN
    FOR v_t IN SELECT * FROM jsonb_array_elements(p_payload->'tiers') LOOP
      v_id := CASE WHEN v_t ? 'id' AND length(coalesce(v_t->>'id','')) > 0 THEN (v_t->>'id')::uuid END;
      SELECT to_jsonb(tt) INTO v_exist FROM public.ticket_types tt WHERE tt.id = v_id AND tt.event_id = p_event_id;
      IF v_exist IS NOT NULL THEN
        -- merged-diff update of editable columns only (inventory counters preserved)
        v_tier := jsonb_populate_record(NULL::public.ticket_types, v_exist || v_t);
        UPDATE public.ticket_types SET
          name=v_tier.name, tier_type=v_tier.tier_type, price_cents=v_tier.price_cents,
          min_price_cents=v_tier.min_price_cents, currency=v_tier.currency,
          quantity_total=v_tier.quantity_total, quantity_reserved_comp=v_tier.quantity_reserved_comp,
          max_per_order=v_tier.max_per_order, max_per_user=v_tier.max_per_user,
          price_schedule=v_tier.price_schedule, sub_allocations=v_tier.sub_allocations,
          sale_start=v_tier.sale_start, sale_end=v_tier.sale_end, tier_visibility=v_tier.tier_visibility,
          unlock_code=v_tier.unlock_code, unlocks_after_tier_id=v_tier.unlocks_after_tier_id,
          status=v_tier.status, sort_order=v_tier.sort_order, perks=v_tier.perks, glow_color=v_tier.glow_color
        WHERE id = v_id;  -- trg_tier_capacity_guard enforces quantity_total >= sold
      ELSE
        v_tier := jsonb_populate_record(NULL::public.ticket_types, v_t || jsonb_build_object('event_id', p_event_id));
        INSERT INTO public.ticket_types (
          event_id, name, tier_type, price_cents, min_price_cents, currency, quantity_total,
          quantity_reserved_comp, max_per_order, max_per_user, price_schedule, sub_allocations,
          sale_start, sale_end, tier_visibility, unlock_code, status, sort_order, perks, glow_color
        ) VALUES (
          p_event_id, v_tier.name, COALESCE(v_tier.tier_type,'ga'), COALESCE(v_tier.price_cents,0),
          v_tier.min_price_cents, COALESCE(v_tier.currency,'usd'), v_tier.quantity_total,
          COALESCE(v_tier.quantity_reserved_comp,0), v_tier.max_per_order, v_tier.max_per_user,
          COALESCE(v_tier.price_schedule,'[]'::jsonb), COALESCE(v_tier.sub_allocations,'[]'::jsonb),
          v_tier.sale_start, v_tier.sale_end, COALESCE(v_tier.tier_visibility,'public'),
          v_tier.unlock_code, COALESCE(v_tier.status,'on_sale'), COALESCE(v_tier.sort_order,0),
          v_tier.perks, v_tier.glow_color
        );
      END IF;
      v_tiers_upserted := v_tiers_upserted + 1;
    END LOOP;
  END IF;

  -- ── add-ons (upsert by id) + variants ──
  IF jsonb_typeof(p_payload->'addons') = 'array' THEN
    FOR v_a IN SELECT * FROM jsonb_array_elements(p_payload->'addons') LOOP
      v_id := CASE WHEN v_a ? 'id' AND length(coalesce(v_a->>'id','')) > 0 THEN (v_a->>'id')::uuid END;
      SELECT to_jsonb(a) INTO v_exist FROM public.ticket_addons a WHERE a.id = v_id AND a.event_id = p_event_id;
      IF v_exist IS NOT NULL THEN
        v_addon := jsonb_populate_record(NULL::public.ticket_addons, v_exist || (v_a - 'variants'));
        UPDATE public.ticket_addons SET
          name=v_addon.name, description=v_addon.description, addon_type=v_addon.addon_type,
          binding_mode=v_addon.binding_mode, price_cents=v_addon.price_cents, min_price_cents=v_addon.min_price_cents,
          quantity_total=v_addon.quantity_total, requires_tier_id=v_addon.requires_tier_id,
          is_redeemable=v_addon.is_redeemable, image_url=v_addon.image_url, sort_order=v_addon.sort_order,
          status=v_addon.status
        WHERE id = v_id;
        v_addon_id := v_id;
      ELSE
        v_addon := jsonb_populate_record(NULL::public.ticket_addons, (v_a - 'variants') || jsonb_build_object('event_id', p_event_id));
        INSERT INTO public.ticket_addons (
          event_id, name, description, addon_type, binding_mode, price_cents, min_price_cents,
          quantity_total, has_variants, requires_tier_id, is_redeemable, image_url, sort_order, status
        ) VALUES (
          p_event_id, v_addon.name, v_addon.description, COALESCE(v_addon.addon_type,'merch'),
          COALESCE(v_addon.binding_mode,'standalone'), COALESCE(v_addon.price_cents,0), v_addon.min_price_cents,
          v_addon.quantity_total, COALESCE(v_addon.has_variants,false), v_addon.requires_tier_id,
          COALESCE(v_addon.is_redeemable,false), v_addon.image_url, COALESCE(v_addon.sort_order,0),
          COALESCE(v_addon.status,'on_sale')
        ) RETURNING id INTO v_addon_id;
      END IF;
      v_addons_upserted := v_addons_upserted + 1;

      IF jsonb_typeof(v_a->'variants') = 'array' THEN
        FOR v_v IN SELECT * FROM jsonb_array_elements(v_a->'variants') LOOP
          v_id := CASE WHEN v_v ? 'id' AND length(coalesce(v_v->>'id','')) > 0 THEN (v_v->>'id')::uuid END;
          SELECT to_jsonb(vv) INTO v_exist FROM public.ticket_addon_variants vv WHERE vv.id = v_id AND vv.addon_id = v_addon_id;
          IF v_exist IS NOT NULL THEN
            v_variant := jsonb_populate_record(NULL::public.ticket_addon_variants, v_exist || v_v);
            UPDATE public.ticket_addon_variants SET
              name=v_variant.name, option_values=v_variant.option_values, price_cents=v_variant.price_cents,
              quantity_total=v_variant.quantity_total, sku=v_variant.sku, sort_order=v_variant.sort_order
            WHERE id = v_id;
          ELSE
            v_variant := jsonb_populate_record(NULL::public.ticket_addon_variants, v_v || jsonb_build_object('addon_id', v_addon_id));
            INSERT INTO public.ticket_addon_variants (addon_id, name, option_values, price_cents, quantity_total, sku, sort_order)
            VALUES (v_addon_id, v_variant.name, COALESCE(v_variant.option_values,'{}'::jsonb), v_variant.price_cents,
                    v_variant.quantity_total, v_variant.sku, COALESCE(v_variant.sort_order,0));
          END IF;
          v_variants_upserted := v_variants_upserted + 1;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'eventId', p_event_id,
    'tiers', v_tiers_upserted, 'addons', v_addons_upserted, 'variants', v_variants_upserted);
END;
$$;

REVOKE ALL ON FUNCTION public.save_event_aggregate(bigint, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.save_event_aggregate(bigint, jsonb) TO service_role;
