-- Re-assert durable idempotency for direct-message writes.
--
-- 20260905120000_watch_message_delivery.sql already defines
-- messages.operation_id as uuid plus messages_sender_operation_unique. The
-- connected DVNT database did not have the column/index at audit time, so
-- this repeats that exact definition idempotently: a no-op where it exists,
-- the missing piece where it does not. send-message validates operationId as
-- a UUID; brand-outbox-worker maps its provider key to a deterministic UUID.
--
-- This changes no existing message, conversation, receipt, grant or sender.
BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS operation_id uuid;

-- The sender owns the operation key across every conversation; a replay for
-- a different conversation cannot masquerade as the original. Multiple NULL
-- operation IDs remain legal for legacy clients and historical messages.
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_operation_unique
  ON public.messages (sender_id, operation_id)
  WHERE operation_id IS NOT NULL;

COMMIT;
