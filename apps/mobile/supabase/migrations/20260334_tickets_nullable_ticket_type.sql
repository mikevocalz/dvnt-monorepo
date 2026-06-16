-- ============================================================================
-- Fix: RSVP tickets fail to insert because ticket_type_id is NOT NULL
-- but issue_rsvp_ticket() doesn't set it. Make it nullable so free RSVP
-- tickets can exist without a ticket type.
-- Also add transfer_pending to the status CHECK constraint.
-- ============================================================================

-- 1. Drop the NOT NULL constraint on ticket_type_id
ALTER TABLE tickets ALTER COLUMN ticket_type_id DROP NOT NULL;

-- 2. Update the status CHECK to include transfer_pending
-- (some tickets may already have this status from the transfer flow)
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('active', 'scanned', 'refunded', 'void', 'transfer_pending'));

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
