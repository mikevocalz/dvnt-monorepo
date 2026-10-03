-- Add 'room_invite' to the notification type enum.
--
-- event-lynk-invite, video_create_room's push path and every client
-- Activity renderer already use 'room_invite', but the live enum never had
-- it (checked read-only against pg_enum on 2026-10-03), so every
-- notifications insert with that type failed with 22P02.
--
-- Kept alone in its own migration: ALTER TYPE ... ADD VALUE cannot share a
-- transaction with a statement that uses the new value.
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'room_invite';
