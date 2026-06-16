-- Sneaky Lynk hand raise state
-- Persists raised-hand status on active room memberships so host/participants
-- receive realtime updates via video_room_members subscriptions.

ALTER TABLE public.video_room_members
  ADD COLUMN IF NOT EXISTS hand_raised BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS video_room_members_active_hands_idx
  ON public.video_room_members (room_id, user_id)
  WHERE status = 'active' AND hand_raised = true;
