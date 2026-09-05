-- Co-host invitations for Lynk rooms.
--
-- A host "promotes" someone with video_change_role, which flips their role
-- underneath them: no consent step, no record, and it only reaches someone
-- already in the room looking at it. Nothing to accept later, nothing that
-- survives closing the app.
--
-- Modelled on the event_co_organizers invite flow, which already proved the
-- shape (pending row + notification + push + accept/decline Edge Function).
alter type enum_notifications_type add value if not exists 'lynk_cohost_invited';
alter type enum_notifications_type add value if not exists 'lynk_cohost_accepted';
alter type enum_notifications_type add value if not exists 'lynk_cohost_declined';
alter type enum_notifications_entity_type add value if not exists 'lynk_room';
