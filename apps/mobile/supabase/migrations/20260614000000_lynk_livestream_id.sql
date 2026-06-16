-- Lynk Live (native WHIP/WHEP transport): each PUBLISHER in a Lynk room owns a
-- 1-streamer Fishjam livestream room. A Fishjam livestream is one-streamer →
-- many-viewers, so multi-speaker = one livestream room per publisher; viewers
-- render one RTCView per publisher. We persist each publisher's livestream id on
-- their existing membership row (create-once, reused across reconnects) rather
-- than add a table — it is per (room, member) by construction.
--
-- Web uses MoQ (no livestream id needed); this column is only populated for
-- native publishers. NULL for viewers and for web-only rooms.

ALTER TABLE video_room_members
  ADD COLUMN IF NOT EXISTS livestream_id TEXT;

COMMENT ON COLUMN video_room_members.livestream_id IS
  'Fishjam livestream room id for this member''s native WHIP publish (Lynk Live). NULL for viewers / web MoQ.';
