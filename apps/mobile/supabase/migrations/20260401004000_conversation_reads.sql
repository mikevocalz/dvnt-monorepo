-- ============================================================================
-- Authoritative per-user conversation read cursors
--
-- Root cause addressed:
--   The app already computes unread state from per-viewer read cursors, but
--   production never received the conversation_reads table. That forced unread
--   logic back onto messages.read_at, which is a global receipt and cannot
--   represent per-user unread truth across inbox, requests, and group chat.
--
-- Backfill strategy:
--   1. Recover each viewer's latest trustworthy read cursor from:
--      - the latest message they sent in the conversation
--      - the latest inbound message.read_at that already proves they read
--   2. Seed conversation_reads from that derived cursor
--   3. Reconcile legacy direct-message read_at rows so visible read receipts
--      stay aligned with the new unread source of truth
--
-- Important limitation:
--   Historic group-chat opens that never produced any persisted marker cannot
--   be reconstructed perfectly from existing data. This migration preserves
--   the best recoverable truth and fixes forward-going correctness.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_reads (
  conversation_id INTEGER NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_reads_user_conv
  ON public.conversation_reads (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_reads_conv_user
  ON public.conversation_reads (conversation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_reads_user_last_read
  ON public.conversation_reads (user_id, last_read_at DESC);

ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.conversation_reads TO anon;
GRANT SELECT ON public.conversation_reads TO authenticated;

DROP POLICY IF EXISTS conversation_reads_select_anon ON public.conversation_reads;
CREATE POLICY conversation_reads_select_anon ON public.conversation_reads
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS conversation_reads_select_authenticated ON public.conversation_reads;
CREATE POLICY conversation_reads_select_authenticated ON public.conversation_reads
  FOR SELECT TO authenticated USING (true);

WITH participant_conversations AS (
  SELECT
    c.id AS conversation_id,
    c.is_group,
    u.id AS user_id
  FROM public.conversations c
  JOIN public.conversations_rels cr
    ON cr.parent_id = c.id
  JOIN public.users u
    ON u.auth_id = cr.users_id
),
derived_read_state AS (
  SELECT
    pc.conversation_id,
    pc.user_id,
    GREATEST(
      COALESCE(
        MAX(
          CASE
            WHEN m.sender_id = pc.user_id THEN m.created_at
            ELSE NULL
          END
        ),
        '-infinity'::timestamptz
      ),
      COALESCE(
        MAX(
          CASE
            WHEN m.sender_id <> pc.user_id AND m.read_at IS NOT NULL THEN m.read_at
            ELSE NULL
          END
        ),
        '-infinity'::timestamptz
      )
    ) AS last_read_at
  FROM participant_conversations pc
  LEFT JOIN public.messages m
    ON m.conversation_id = pc.conversation_id
  GROUP BY pc.conversation_id, pc.user_id
),
seed_rows AS (
  SELECT
    conversation_id,
    user_id,
    last_read_at
  FROM derived_read_state
  WHERE last_read_at > '-infinity'::timestamptz
)
INSERT INTO public.conversation_reads (
  conversation_id,
  user_id,
  last_read_at,
  created_at,
  updated_at
)
SELECT
  sr.conversation_id,
  sr.user_id,
  sr.last_read_at,
  timezone('utc', now()),
  timezone('utc', now())
FROM seed_rows sr
ON CONFLICT (conversation_id, user_id) DO UPDATE
SET
  last_read_at = GREATEST(
    public.conversation_reads.last_read_at,
    EXCLUDED.last_read_at
  ),
  updated_at = timezone('utc', now());

WITH participant_conversations AS (
  SELECT
    c.id AS conversation_id,
    c.is_group,
    u.id AS user_id
  FROM public.conversations c
  JOIN public.conversations_rels cr
    ON cr.parent_id = c.id
  JOIN public.users u
    ON u.auth_id = cr.users_id
),
derived_read_state AS (
  SELECT
    pc.conversation_id,
    pc.user_id,
    pc.is_group,
    GREATEST(
      COALESCE(
        MAX(
          CASE
            WHEN m.sender_id = pc.user_id THEN m.created_at
            ELSE NULL
          END
        ),
        '-infinity'::timestamptz
      ),
      COALESCE(
        MAX(
          CASE
            WHEN m.sender_id <> pc.user_id AND m.read_at IS NOT NULL THEN m.read_at
            ELSE NULL
          END
        ),
        '-infinity'::timestamptz
      )
    ) AS last_read_at
  FROM participant_conversations pc
  LEFT JOIN public.messages m
    ON m.conversation_id = pc.conversation_id
  GROUP BY pc.conversation_id, pc.user_id, pc.is_group
)
UPDATE public.messages m
SET read_at = d.last_read_at
FROM derived_read_state d
WHERE d.is_group = false
  AND d.last_read_at > '-infinity'::timestamptz
  AND m.conversation_id = d.conversation_id
  AND m.sender_id <> d.user_id
  AND m.created_at <= d.last_read_at
  AND (m.read_at IS NULL OR m.read_at < d.last_read_at);
