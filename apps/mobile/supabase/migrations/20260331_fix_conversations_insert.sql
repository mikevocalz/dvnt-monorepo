-- ============================================================================
-- FIX: "permission denied for table conversations"
-- Re-grant INSERT + re-create INSERT/UPDATE policies that may have been
-- lost after the comprehensive SELECT-only migration ran.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. CONVERSATIONS ────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE conversations_id_seq TO authenticated;

DROP POLICY IF EXISTS conversations_insert_authenticated ON public.conversations;
CREATE POLICY conversations_insert_authenticated ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS conversations_update_authenticated ON public.conversations;
CREATE POLICY conversations_update_authenticated ON public.conversations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── 2. CONVERSATIONS_RELS ───────────────────────────────────────────────────
GRANT SELECT, INSERT, DELETE ON public.conversations_rels TO authenticated;

DROP POLICY IF EXISTS conv_rels_insert_authenticated ON public.conversations_rels;
CREATE POLICY conv_rels_insert_authenticated ON public.conversations_rels
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS conv_rels_delete_authenticated ON public.conversations_rels;
CREATE POLICY conv_rels_delete_authenticated ON public.conversations_rels
  FOR DELETE TO authenticated USING (true);

-- ── 3. MESSAGES (ensure full access) ────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE messages_id_seq TO authenticated;

DROP POLICY IF EXISTS messages_insert_authenticated ON public.messages;
CREATE POLICY messages_insert_authenticated ON public.messages
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS messages_update_authenticated ON public.messages;
CREATE POLICY messages_update_authenticated ON public.messages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS messages_delete_authenticated ON public.messages;
CREATE POLICY messages_delete_authenticated ON public.messages
  FOR DELETE TO authenticated USING (true);
