-- The ticket-email delivery module writes order_timeline entries of type
-- ticket_email_sent / ticket_email_resent / ticket_email_failed, but the
-- CHECK constraint predates them. Without these values every post-send
-- timeline insert violates the constraint — and in the module that throw
-- lands in the send's catch, flipping a successfully-sent order back to
-- 'failed'. Widening the constraint is the fix; the module also wraps
-- timeline writes so a future audit-log failure can't corrupt delivery
-- state.
ALTER TABLE public.order_timeline DROP CONSTRAINT order_timeline_type_check;
ALTER TABLE public.order_timeline ADD CONSTRAINT order_timeline_type_check
  CHECK (type = ANY (ARRAY[
    'created'::text, 'payment_authorized'::text, 'payment_captured'::text,
    'receipt_generated'::text, 'refund_requested'::text, 'refund_processed'::text,
    'dispute_opened'::text, 'dispute_resolved'::text, 'payment_processing'::text,
    'payment_failed'::text, 'reconciled'::text, 'reconcile_blocked'::text,
    'ticket_email_sent'::text, 'ticket_email_resent'::text,
    'ticket_email_failed'::text
  ]));
