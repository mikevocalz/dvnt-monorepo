-- Source-only rollout. Apply before releasing co-host editing clients.
-- Content/catalog editing does not grant ownership, payouts or event deletion.
BEGIN;

CREATE OR REPLACE FUNCTION public.can_edit_event(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (
      e.host_id = NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub'
      OR EXISTS (
        SELECT 1 FROM public.event_co_organizers c WHERE c.event_id = e.id
          AND c.user_id = NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub'
          AND c.accepted IS TRUE AND c.role IN ('admin', 'editor')
      )
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_event(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_event(integer) TO authenticated, service_role;

DROP POLICY IF EXISTS events_update_host_or_coorg ON public.events;
CREATE POLICY events_update_host_or_coorg ON public.events FOR UPDATE TO authenticated
  USING (public.can_edit_event(id)) WITH CHECK (public.can_edit_event(id));

CREATE OR REPLACE FUNCTION public.enforce_event_owner_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_sub text := NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub';
  -- An allowlist deliberately protects unknown/future financial/security fields.
  v_content text[] := ARRAY[
    'title', 'description', 'start_date', 'end_date', 'event_tz',
    'location', 'location_name', 'location_lat', 'location_lng', 'is_online',
    'cover_image_url', 'flyer_image_url', 'video_flyer_url', 'images',
    'price', 'max_attendees', 'ticketing_enabled', 'category', 'event_type', 'nsfw',
    'visibility', 'is_hidden', 'publish_at', 'show_attendees',
    'age_restriction', 'dress_code', 'door_policy', 'lineup', 'perks',
    'youtube_video_url', 'updated_at'
  ];
BEGIN
  -- Preserve trusted server writes and the existing owner authority.
  IF (v_sub IS NULL AND current_user NOT IN ('anon', 'authenticated'))
    OR OLD.host_id = v_sub THEN RETURN COALESCE(NEW, OLD); END IF;
  -- RSVP/ticket SECURITY DEFINER triggers maintain counters under buyer JWTs.
  -- RLS still disallows direct buyer UPDATEs; never combine this exception with
  -- an edit to any other column.
  IF current_user <> 'authenticated' AND TG_OP = 'UPDATE' AND
    (to_jsonb(OLD) - 'total_attendees' - 'attendees') =
    (to_jsonb(NEW) - 'total_attendees' - 'attendees') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND public.can_edit_event(OLD.id) AND
    (to_jsonb(OLD) - v_content) = (to_jsonb(NEW) - v_content) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'not authorized to modify this event' USING ERRCODE = '42501';
END;
$$;

-- Tier creation and edits use PostgREST, not the service-only aggregate RPC.
DROP POLICY IF EXISTS ticket_types_insert ON public.ticket_types;
CREATE POLICY ticket_types_insert ON public.ticket_types FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_event(event_id));
DROP POLICY IF EXISTS ticket_types_update ON public.ticket_types;
CREATE POLICY ticket_types_update ON public.ticket_types FOR UPDATE TO authenticated
  USING (public.can_edit_event(event_id)) WITH CHECK (public.can_edit_event(event_id));

-- SECURITY INVOKER is intentional: definer purchase/hold RPCs maintain sold
-- counters as their owner, whereas direct PostgREST writes run authenticated.
CREATE OR REPLACE FUNCTION public.guard_cohost_ticket_catalog_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_sub text := NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub';
  v_catalog text[] := ARRAY[
    'name', 'description', 'category', 'price_cents', 'currency', 'quantity_total',
    'max_per_user', 'max_per_order', 'sale_start', 'sale_end', 'is_active',
    'tier_type', 'tier_visibility', 'unlock_code', 'price_schedule',
    'sub_allocations', 'sort_order', 'status', 'updated_at'
  ];
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.host_id = v_sub)
    AND (TG_OP = 'INSERT' OR OLD.event_id = NEW.event_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.quantity_sold, 0) <> 0 OR COALESCE(NEW.quantity_held, 0) <> 0
      OR COALESCE(NEW.quantity_reserved_comp, 0) <> 0
      OR COALESCE(NEW.capacity_alert_level, 0) <> 0 THEN
      RAISE EXCEPTION 'Ticket inventory counters are server-managed' USING ERRCODE = '42501';
    END IF;
  ELSIF (to_jsonb(OLD) - v_catalog) IS DISTINCT FROM (to_jsonb(NEW) - v_catalog) THEN
    RAISE EXCEPTION 'Only ticket catalog fields may be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_cohost_ticket_catalog_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_cohost_ticket_catalog_write ON public.ticket_types;
CREATE TRIGGER guard_cohost_ticket_catalog_write BEFORE INSERT OR UPDATE ON public.ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_cohost_ticket_catalog_write();
COMMIT;
