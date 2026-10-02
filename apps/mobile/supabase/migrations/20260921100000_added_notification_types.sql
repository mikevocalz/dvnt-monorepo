-- Notification types for direct staff/promoter adds (picker flow):
-- distinct from the invite/accept lifecycle so the audit trail shows the
-- person was added outright, not invited pending acceptance.
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_staff_added';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_promoter_added';
