-- ============================================================
-- Anonymous Sneaky Lynk Members
-- Adds is_anonymous + anon_label to video_room_members
-- ============================================================

ALTER TABLE public.video_room_members
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anon_label TEXT;
