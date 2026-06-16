-- ============================================================================
-- Historical group unread cutover
--
-- Before conversation_reads existed, DVNT never persisted authoritative
-- per-user read state for group chats. That means any pre-cutover group unread
-- still visible after the conversation_reads rollout is unrecoverable history,
-- not trustworthy unread truth.
--
-- This migration establishes a clean baseline by marking all existing group
-- conversation history as read for current participants at the latest message
-- timestamp in each group. Future group unread remains accurate because:
--   - mark-read now writes conversation_reads on open
--   - send-message advances the sender's own cursor
--   - bootstrap unread queries now read from conversation_reads
-- ============================================================================

WITH latest_group_message AS (
  SELECT
    c.id AS conversation_id,
    MAX(m.created_at) AS latest_message_at
  FROM public.conversations c
  JOIN public.messages m
    ON m.conversation_id = c.id
  WHERE c.is_group = true
  GROUP BY c.id
),
group_participants AS (
  SELECT
    lgm.conversation_id,
    u.id AS user_id,
    lgm.latest_message_at
  FROM latest_group_message lgm
  JOIN public.conversations_rels cr
    ON cr.parent_id = lgm.conversation_id
  JOIN public.users u
    ON u.auth_id = cr.users_id
  WHERE lgm.latest_message_at IS NOT NULL
)
INSERT INTO public.conversation_reads (
  conversation_id,
  user_id,
  last_read_at,
  created_at,
  updated_at
)
SELECT
  gp.conversation_id,
  gp.user_id,
  gp.latest_message_at,
  timezone('utc', now()),
  timezone('utc', now())
FROM group_participants gp
ON CONFLICT (conversation_id, user_id) DO UPDATE
SET
  last_read_at = GREATEST(
    public.conversation_reads.last_read_at,
    EXCLUDED.last_read_at
  ),
  updated_at = timezone('utc', now());
