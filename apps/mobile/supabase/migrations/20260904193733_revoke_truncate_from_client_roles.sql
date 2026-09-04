-- TRUNCATE was granted to anon/authenticated on 8 tables — almost certainly a
-- stray GRANT ALL. It is never legitimate for a client role:
--
--   * TRUNCATE IGNORES ROW LEVEL SECURITY. Every carefully written policy on
--     these tables is irrelevant to it.
--   * PostgREST exposes no truncate verb, so no app code can be relying on it.
--   * The anon key ships inside the app binary, so this was one statement away
--     from wiping every RSVP (event_rsvps) or silencing all notifications
--     (push_tokens).
--
-- Revoked explicitly per table rather than with a loop so the list is auditable
-- in the migration history.
revoke truncate on public.call_signals        from anon, authenticated;
revoke truncate on public.event_comment_tags  from anon, authenticated;
revoke truncate on public.event_comments      from anon, authenticated;
revoke truncate on public.event_reviews       from anon, authenticated;
revoke truncate on public.event_rsvps         from anon, authenticated;
revoke truncate on public.push_tokens         from anon, authenticated;
revoke truncate on public.story_views         from anon, authenticated;
revoke truncate on public.user_presence       from anon, authenticated;
