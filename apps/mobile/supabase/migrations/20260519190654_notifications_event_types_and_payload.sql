-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519190654 :: notifications_event_types_and_payload). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Add the activity types the events/ticketing flows now emit. Without
-- these the inserts in cancel-event, notify-event-change, invite-co-organizer,
-- and event-broadcast-message silently violate the enum and the rows
-- never land in the recipient's activity feed.
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_broadcast';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_cancelled';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_changed';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_co_organizer_invited';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_co_organizer_accepted';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_co_organizer_declined';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_co_organizer_revoked';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_transfer_initiated';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_transfer_accepted';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_transfer_declined';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_transfer_cancelled';

-- Payload bag for activity rows that carry inline content
-- (broadcast message body, change summary, etc.). Nullable, JSONB.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS entity_payload jsonb;;
