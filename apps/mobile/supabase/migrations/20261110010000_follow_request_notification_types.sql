-- Apply/commit before the follow-request notification trigger migration.
-- No existing follow relationships, approval grants or ID rules change.
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'follow_request';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'follow_request_approved';
