-- Source-only rollout: follow docs/events/attendee-privacy.md for staged release order.
-- Only Sex Party and linked Sneaky Lynk events default to hidden attendance.
-- No existing event rows are rewritten; ordinary events ignore the new setting.
BEGIN;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS show_attendees boolean DEFAULT false;
COMMENT ON COLUMN public.events.show_attendees IS
  'Explicit organizer opt-in for Sex Party or linked Sneaky Lynk Who''s Going. NULL/false hides those lists; other event types retain existing behavior.';

CREATE OR REPLACE FUNCTION public.can_manage_event_attendance(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(auth.jwt()->>'role','') = 'service_role'
    OR (COALESCE(auth.jwt()->>'role','') = 'authenticated'
      AND NULLIF(auth.jwt()->>'sub','') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND (
        e.host_id=auth.jwt()->>'sub'
        OR EXISTS (SELECT 1 FROM public.event_co_organizers c WHERE c.event_id=e.id
          AND c.user_id=auth.jwt()->>'sub' AND c.accepted IS TRUE AND c.role IN ('admin','editor'))
      )));
$$;
REVOKE ALL ON FUNCTION public.can_manage_event_attendance(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_attendance(integer) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.event_attendees_visible(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
    AND (NOT (COALESCE(NULLIF(e.event_type,''),e.category::text,'')='sex_party' OR e.lynk_room_id IS NOT NULL)
      OR (e.show_attendees IS TRUE AND public.can_view_event(e.id) AND public.viewer_is_attending(e.id)
        AND (COALESCE(auth.jwt()->>'role','')='service_role' OR (
          COALESCE(auth.jwt()->>'role','')='authenticated' AND NULLIF(auth.jwt()->>'sub','') IS NOT NULL AND (
            e.host_id=auth.jwt()->>'sub'
            OR EXISTS (SELECT 1 FROM public.event_co_organizers c WHERE c.event_id=e.id
              AND c.user_id=auth.jwt()->>'sub' AND c.accepted IS TRUE)
            OR EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.event_id=e.id
              AND r.user_id=auth.jwt()->>'sub' AND r.status='going')
            OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
              AND t.user_id=auth.jwt()->>'sub' AND t.status IN ('active','scanned'))
          )
        )))));
$$;
REVOKE ALL ON FUNCTION public.event_attendees_visible(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_attendees_visible(integer) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_event_attendee_visibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_protected boolean := COALESCE(NULLIF(NEW.event_type,''),NEW.category::text,'')='sex_party' OR NEW.lynk_room_id IS NOT NULL;
  v_was_protected boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.show_attendees IS TRUE AND COALESCE(auth.jwt()->>'role','')<>'service_role'
      AND NOT (COALESCE(auth.jwt()->>'role','')='authenticated' AND NEW.host_id=auth.jwt()->>'sub') THEN
      RAISE EXCEPTION 'Only the organizer may enable attendee visibility' USING ERRCODE='42501';
    END IF;
  ELSE
    -- A pending co-organizer must not take ownership first and then use the
    -- owner-only visibility/roster paths in a second request.
    IF NEW.host_id IS DISTINCT FROM OLD.host_id
      AND COALESCE(auth.jwt()->>'role','')<>'service_role'
      AND NOT (COALESCE(auth.jwt()->>'role','')='authenticated' AND OLD.host_id=auth.jwt()->>'sub') THEN
      RAISE EXCEPTION 'Only the current owner may transfer event ownership' USING ERRCODE='42501';
    END IF;
    -- Existing event write policies admit pending co-organizers. Do not let that
    -- become authority to expose attendance or remove its protected type/room.
    IF (NEW.show_attendees IS DISTINCT FROM OLD.show_attendees
      OR NEW.event_type IS DISTINCT FROM OLD.event_type
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.lynk_room_id IS DISTINCT FROM OLD.lynk_room_id)
      AND NOT public.can_manage_event_attendance(OLD.id) THEN
      RAISE EXCEPTION 'Only the organizer may change attendee visibility' USING ERRCODE='42501';
    END IF;
    v_was_protected := COALESCE(NULLIF(OLD.event_type,''),OLD.category::text,'')='sex_party' OR OLD.lynk_room_id IS NOT NULL;
    -- Ordinary rows cannot carry a latent opt-in. Defend against legacy/manual
    -- stale values too; an explicit false->true choice on this save is allowed.
    IF v_protected AND NOT v_was_protected AND NEW.show_attendees IS NOT DISTINCT FROM OLD.show_attendees THEN
      NEW.show_attendees := false;
    END IF;
  END IF;
  IF NOT v_protected THEN NEW.show_attendees := false; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_event_attendee_visibility() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS enforce_event_attendee_visibility ON public.events;
CREATE TRIGGER enforce_event_attendee_visibility BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_attendee_visibility();

-- Narrow every legacy permissive policy. Self RSVP and authorized management
-- remain available; raw REST/GraphQL/realtime reads cannot reveal other guests.
DROP POLICY IF EXISTS event_rsvps_attendee_visibility ON public.event_rsvps;
CREATE POLICY event_rsvps_attendee_visibility ON public.event_rsvps AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (
    public.event_attendees_visible(event_id)
    OR user_id=NULLIF(auth.jwt()->>'sub','')
    OR public.can_manage_event_attendance(event_id)
  );

DO $migration$
DECLARE
  v_spec jsonb;
  v_patch jsonb;
  v_oid oid;
  v_definition text;
  v_updated text;
  v_before_count integer;
  v_after_count integer;
  v_expected integer;
  v_metadata jsonb;
  v_arguments text;
  v_prepared jsonb := '[]'::jsonb;
BEGIN
  -- Prepare and validate every target before replacing any function. Every other
  -- byte of pg_get_functiondef is retained, including security and SQL predicates.
  FOR v_spec IN SELECT value FROM jsonb_array_elements($patches$
[
  {
    "signature": "public.get_event_attendee_avatars(integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "and public.viewer_is_attending(p_event_id);",
        "after": "and public.viewer_is_attending(p_event_id)\n    and public.event_attendees_visible(p_event_id);"
      }
    ]
  },
  {
    "signature": "public.get_event_attendee_page(integer,integer,integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "and public.viewer_is_attending(p_event_id);",
        "after": "and public.viewer_is_attending(p_event_id)\n    and public.event_attendees_visible(p_event_id);"
      }
    ]
  },
  {
    "signature": "public.get_event_detail(integer,integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.event_tz, e.lynk_room_id,\n",
        "after": "e.event_tz, e.lynk_room_id, e.show_attendees,\n"
      }
    ]
  },
  {
    "signature": "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.share_slug,\n",
        "after": "e.share_slug, e.lynk_room_id, e.show_attendees,\n"
      },
      {
        "expected": 1,
        "before": "COALESCE(att.avatars, '[]'::json) AS attendee_avatars,",
        "after": "CASE WHEN public.event_attendees_visible(e.id) THEN COALESCE(att.avatars, '[]'::json) ELSE '[]'::json END AS attendee_avatars,"
      }
    ]
  },
  {
    "signature": "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.share_slug,\n",
        "after": "e.share_slug, e.lynk_room_id, e.show_attendees,\n"
      },
      {
        "expected": 1,
        "before": "COALESCE(att.avatars, '[]'::json) AS attendee_avatars,",
        "after": "CASE WHEN public.event_attendees_visible(e.id) THEN COALESCE(att.avatars, '[]'::json) ELSE '[]'::json END AS attendee_avatars,"
      }
    ]
  },
  {
    "signature": "public.get_events_for_you(integer,integer,integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.share_slug,\n",
        "after": "e.share_slug, e.lynk_room_id, e.show_attendees,\n"
      },
      {
        "expected": 1,
        "before": "COALESCE(att.avatars, '[]'::json) AS attendee_avatars,",
        "after": "CASE WHEN public.event_attendees_visible(e.id) THEN COALESCE(att.avatars, '[]'::json) ELSE '[]'::json END AS attendee_avatars,"
      },
      {
        "expected": 1,
        "before": ") friends ON true",
        "after": ") friends ON public.event_attendees_visible(e.id)"
      }
    ]
  }
]
$patches$::jsonb)
  LOOP
    v_oid := to_regprocedure(v_spec->>'signature');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Missing verified event RPC: %', v_spec->>'signature';
    END IF;
    SELECT pg_get_functiondef(p.oid),
           to_jsonb(p) - ARRAY['prosrc', 'proargdefaults', 'prosqlbody'],
           pg_get_function_arguments(p.oid)
      INTO v_definition, v_metadata, v_arguments
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_oid AND l.lanname IN ('plpgsql','sql') AND p.prorettype = 'json'::regtype;
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Unexpected language/return type for event RPC: %', v_spec->>'signature';
    END IF;
    v_updated := v_definition;
    FOR v_patch IN SELECT value FROM jsonb_array_elements(v_spec->'replacements')
    LOOP
      v_expected := (v_patch->>'expected')::integer;
      v_before_count := (length(v_updated) - length(replace(v_updated, v_patch->>'before', ''))) / length(v_patch->>'before');
      v_after_count := (length(v_updated) - length(replace(v_updated, v_patch->>'after', ''))) / length(v_patch->>'after');
      IF v_before_count = v_expected AND v_after_count = 0 THEN
        v_updated := replace(v_updated, v_patch->>'before', v_patch->>'after');
      ELSIF v_before_count = 0 AND v_after_count = v_expected THEN
        NULL; -- already upgraded
      ELSE
        RAISE EXCEPTION 'Event RPC definition drift for % (expected %, before %, after %)',
          v_spec->>'signature', v_expected, v_before_count, v_after_count;
      END IF;
    END LOOP;
    v_prepared := v_prepared || jsonb_build_array(jsonb_build_object(
      'oid', v_oid, 'definition', v_updated, 'changed', v_updated <> v_definition,
      'metadata', v_metadata, 'arguments', v_arguments, 'signature', v_spec->>'signature'
    ));
  END LOOP;

  FOR v_spec IN SELECT value FROM jsonb_array_elements(v_prepared)
  LOOP
    IF (v_spec->>'changed')::boolean THEN
      EXECUTE v_spec->>'definition';
    END IF;
    -- CREATE OR REPLACE must retain the OID, owner, ACL, signature/defaults,
    -- security-definer mode, volatility, search_path, planner settings, etc.
    -- Raw default-expression parse trees contain source locations; compare their
    -- canonical argument rendering separately instead of comparing those offsets.
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = (v_spec->>'oid')::oid
        AND (to_jsonb(p) - ARRAY['prosrc', 'proargdefaults', 'prosqlbody']) = v_spec->'metadata'
        AND pg_get_function_arguments(p.oid) = v_spec->>'arguments'
        AND pg_get_functiondef(p.oid) = v_spec->>'definition'
    ) THEN
      RAISE EXCEPTION 'Event RPC metadata changed unexpectedly: %', v_spec->>'signature';
    END IF;
  END LOOP;
END;
$migration$;

COMMIT;
NOTIFY pgrst, 'reload schema';
