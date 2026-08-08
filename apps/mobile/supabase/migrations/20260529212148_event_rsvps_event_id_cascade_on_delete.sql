-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260529212148 :: event_rsvps_event_id_cascade_on_delete). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- event_rsvps.event_id is NOT NULL but FK is SET NULL — contradictory.
-- An RSVP without an event is meaningless, so cascade the delete.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.event_rsvps'::regclass
    AND contype = 'f'
    AND array_length(conkey, 1) = 1
    AND conkey[1] = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.event_rsvps'::regclass AND attname = 'event_id'
    );

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.event_rsvps DROP CONSTRAINT %I', cname);
  END IF;

  ALTER TABLE public.event_rsvps
    ADD CONSTRAINT event_rsvps_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
END $$;;
