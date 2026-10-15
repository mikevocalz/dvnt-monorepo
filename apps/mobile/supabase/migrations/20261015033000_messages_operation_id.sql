-- Restore durable idempotency for direct-message writes.
--
-- send-message already emits operation_id and recovers unique-key replays, but
-- the connected DVNT database did not have the column/index at audit time.
-- The brand-outbox DM worker previously put the idempotency key in JSON
-- metadata only, so a lost acknowledgement could deliver a duplicate DM.
--
-- This changes no existing message, conversation, receipt, grant or sender.
BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS operation_id text;

-- The sender owns the operation key across every conversation; a replay for
-- a different conversation cannot masquerade as the original. Multiple NULL
-- operation IDs remain legal for legacy clients and historical messages.
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_operation_id_unique
  ON public.messages (sender_id, operation_id)
  WHERE operation_id IS NOT NULL;

COMMIT;
