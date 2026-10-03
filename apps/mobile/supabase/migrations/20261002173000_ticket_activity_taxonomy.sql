-- Canonical ticket/event lifecycle notification taxonomy for the Activity center.
-- Existing ticket_comped/ticket_refunded/transfer values remain valid; these
-- cover states that previously had to fall back to a generic event_changed row.

ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_claim_required';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_delivery_failed';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'ticket_voided';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_postponed';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_time_changed';
ALTER TYPE public.enum_notifications_type ADD VALUE IF NOT EXISTS 'event_venue_changed';
