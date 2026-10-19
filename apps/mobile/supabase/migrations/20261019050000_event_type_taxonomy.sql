-- Add the existing canonical events.event_type to JSON RPC responses and discovery.
-- Uses narrow patterns already present in repository migrations. Capture current
-- definitions privately before release as the rollback basis. No event rows, enum
-- values, signatures, grants, security settings, or visibility predicates change.
-- Only the literal replacements below are allowed. Unexpected schema/body drift
-- fails the entire DO statement atomically; do not weaken these guards to release.
-- Re-running this migration is safe: an already-installed replacement is a no-op.
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'event_type'
      AND a.atttypid = 'text'::regtype AND NOT a.attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.events'::regclass AND a.attname = 'category'
      AND a.atttypid = 'public.enum_events_category'::regtype AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Expected existing events.event_type text and legacy category enum; verify schema before release';
  END IF;

  -- Prepare and validate every target before replacing any function. Every other
  -- byte of pg_get_functiondef is retained, including security and SQL predicates.
  FOR v_spec IN SELECT value FROM jsonb_array_elements($patches$
[
  {
    "signature": "public.get_event_detail(integer,integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.visibility, e.ticketing_enabled, e.category, e.age_restriction,",
        "after": "e.visibility, e.ticketing_enabled, e.category, e.event_type, e.age_restriction,"
      }
    ]
  },
  {
    "signature": "public.get_events_for_you(integer,integer,integer)",
    "replacements": [
      {
        "expected": 1,
        "before": "      e.category,\n      e.visibility,",
        "after": "      e.category,\n      e.event_type,\n      e.visibility,"
      },
      {
        "expected": 2,
        "before": "          AND e2.category = e.category\n          AND e.category IS NOT NULL",
        "after": "          AND COALESCE(e2.event_type, e2.category::text) = COALESCE(e.event_type, e.category::text)\n          AND COALESCE(e.event_type, e.category::text) IS NOT NULL"
      }
    ]
  },
  {
    "signature": "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.max_attendees, e.category, e.visibility, e.location_type,",
        "after": "e.max_attendees, e.category, e.event_type, e.visibility, e.location_type,"
      },
      {
        "expected": 1,
        "before": "AND (p_category IS NULL OR p_category = '' OR e.category = p_category)",
        "after": "AND (p_category IS NULL OR p_category = '' OR COALESCE(e.event_type, e.category::text) = p_category)"
      }
    ]
  },
  {
    "signature": "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)",
    "replacements": [
      {
        "expected": 1,
        "before": "e.max_attendees, e.category::text, e.visibility, e.location_type,",
        "after": "e.max_attendees, e.category::text, e.event_type, e.visibility, e.location_type,"
      },
      {
        "expected": 1,
        "before": "AND (p_category IS NULL OR p_category = '' OR e.category::text = p_category)",
        "after": "AND (p_category IS NULL OR p_category = '' OR COALESCE(e.event_type, e.category::text) = p_category)"
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
    WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prorettype = 'json'::regtype;
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
