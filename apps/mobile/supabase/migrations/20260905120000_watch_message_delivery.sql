-- Nullable for existing phone clients; retries from wearables reuse a sender-scoped UUID.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS operation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_operation_unique
  ON public.messages (sender_id, operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_thread_cursor_idx
  ON public.messages (conversation_id, created_at DESC, id DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'conversation_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_reads;
  END IF;
END $$;
