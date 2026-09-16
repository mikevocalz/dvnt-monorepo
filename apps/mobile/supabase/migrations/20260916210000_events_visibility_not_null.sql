-- events.visibility must never be NULL.
--
-- The column already has DEFAULT 'public' and a CHECK restricting it to
-- public/private/link_only, but a CHECK does not reject NULL: `NULL = ANY(...)`
-- evaluates to NULL, which is not false, so the row is accepted. The column was
-- therefore guarded against a bad value and wide open to no value at all.
--
-- That matters because normalizeVisibility() in packages/app/lib/api/events.ts
-- resolves NULL to "public". A row that lost its visibility would silently
-- become a public event: listed in discovery, attendee avatars fetched, guest
-- list exposed. The audit that prompted this found zero NULL rows in
-- production, so this is closing the hole rather than repairing damage.
--
-- Backfill first so the constraint cannot fail on legacy data. 'public' matches
-- what the application already infers for NULL today, so no event changes
-- meaning: a row that reads as public keeps reading as public.

UPDATE public.events SET visibility = 'public' WHERE visibility IS NULL;

ALTER TABLE public.events
  ALTER COLUMN visibility SET DEFAULT 'public',
  ALTER COLUMN visibility SET NOT NULL;

COMMENT ON COLUMN public.events.visibility IS
  'public | private | link_only. NOT NULL: a missing value would be read as public by normalizeVisibility and expose a private event''s listing and attendees.';
