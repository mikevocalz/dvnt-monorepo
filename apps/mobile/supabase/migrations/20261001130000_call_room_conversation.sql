-- Link a call room back to the group chat it was started from. Group chats
-- query this to show a Join/Rejoin affordance while a call is live, and
-- members who were invited but missed the ring can get back in. Nullable:
-- Lynk rooms and calls not tied to a conversation leave it null.
ALTER TABLE public.video_rooms
  ADD COLUMN IF NOT EXISTS conversation_id integer;

-- Live-call lookup per conversation; open call rows only, tiny and hot.
CREATE INDEX IF NOT EXISTS video_rooms_open_call_conversation_idx
  ON public.video_rooms (conversation_id)
  WHERE room_kind = 'call' AND status = 'open';
