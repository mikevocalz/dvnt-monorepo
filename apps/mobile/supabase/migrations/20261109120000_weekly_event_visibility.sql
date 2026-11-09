-- Source-only release: apply before shipping the new event types / buyer view reads.
-- No ticket, order, payment, or reporting records are removed or rewritten.
BEGIN;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events ADD CONSTRAINT events_event_type_check CHECK (
  event_type IS NULL OR event_type IN (
    'virtual_session','party','picnic','game_night','panel','happy_hour',
    'wine_down','kickback','ball','kiki','pool_party','spoken_word',
    'open_mic','karaoke','bike_ride','walk_run','fitness_training','yoga',
    'meditation','bate_session','sex_party','kink_fetish_party',
    'training','cooking_class','mixology','dance_class','other',
    'glory_hole','cruising','cum_dump'
  )
);

CREATE OR REPLACE FUNCTION public.is_spicy_event_type(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(trim(both '_' from regexp_replace(lower(trim(value)), '[^a-z0-9]+', '_', 'g')) IN
    ('bate_session','kink_fetish_party','kink_play_party','sex_party','glory_hole','cruising','cum_dump'), false);
$$;
CREATE OR REPLACE FUNCTION public.enforce_spicy_event_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF public.is_spicy_event_type(COALESCE(NULLIF(NEW.event_type,''), NEW.category::text)) THEN
    NEW.nsfw := true;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS events_enforce_spicy_type ON public.events;
CREATE TRIGGER events_enforce_spicy_type BEFORE INSERT OR UPDATE OF event_type, category, nsfw
ON public.events FOR EACH ROW EXECUTE FUNCTION public.enforce_spicy_event_type();
UPDATE public.events SET nsfw = true
WHERE public.is_spicy_event_type(COALESCE(NULLIF(event_type,''), category::text)) AND nsfw IS DISTINCT FROM true;

-- Keep the existing buyer-safe projection/column order, add a server-side active
-- predicate. Hosts and historical ticket joins continue using the base table.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns WHERE table_schema='public' AND table_name='ticket_types_public';
  IF cols IS NULL THEN RAISE EXCEPTION 'Expected existing ticket_types_public view'; END IF;
  EXECUTE format('CREATE OR REPLACE VIEW public.ticket_types_public WITH (security_invoker=true) AS SELECT %s FROM public.ticket_types WHERE is_active IS TRUE', cols);
END $$;

-- Preserve the latest RPC body, signatures, security settings, and all existing
-- publication/visibility gates. Unexpected drift aborts this whole transaction.
DO $$
DECLARE spec record; definition text; patched text; before_text text; after_text text;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)', true),
    ('public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)', false),
    ('public.get_events_for_you(integer,integer,integer)', false),
    ('public.get_spotlight_feed(bigint)', false),
    ('public.get_promoted_event_ids(bigint)', false)
  ) AS targets(signature, mode_aware) LOOP
    IF to_regprocedure(spec.signature) IS NULL THEN RAISE EXCEPTION 'Missing RPC %', spec.signature; END IF;
    definition := pg_get_functiondef(to_regprocedure(spec.signature));
    IF spec.mode_aware THEN
      before_text := '(p_nsfw IS NULL OR COALESCE(e.nsfw, false) = p_nsfw)';
      after_text := '(COALESCE(e.nsfw, false) = COALESCE(p_nsfw, false))';
    ELSE
      before_text := 'AND NOT e.is_hidden';
      after_text := 'AND NOT COALESCE(e.nsfw, false) AND NOT e.is_hidden';
    END IF;
    IF position(after_text in definition) > 0 THEN CONTINUE; END IF;
    IF (length(definition)-length(replace(definition,before_text,'')))/length(before_text) <> 1 THEN
      RAISE EXCEPTION 'Unexpected visibility predicate for %', spec.signature;
    END IF;
    patched := replace(definition, before_text, after_text);
    EXECUTE patched;
  END LOOP;
END $$;
COMMIT;
