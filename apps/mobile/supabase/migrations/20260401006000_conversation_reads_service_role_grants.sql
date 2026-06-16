-- Allow edge functions running with the service role key to persist
-- authoritative per-user read cursors for mark-read and send-message.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.conversation_reads
TO service_role;
