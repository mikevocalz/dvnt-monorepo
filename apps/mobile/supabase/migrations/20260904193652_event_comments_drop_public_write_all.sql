-- event_comments carried `event_comments_update_all` and
-- `event_comments_delete_all`, both `TO public USING (true)`. The anon key ships
-- inside the app binary, so that let anyone rewrite or delete ANY user's comment
-- on ANY event. No app code ever used either policy: nothing updates the table,
-- and the only client-side delete is a belt-and-braces cascade in
-- `eventsApi.deleteEvent` that the event_id FK (ON DELETE CASCADE) already
-- covers.
--
-- Authorization for these two verbs now lives in the `event-comment-mutate`
-- Edge Function, which verifies the Better-Auth session and the author id with
-- the service role. RLS cannot express "the author" here: this app does not use
-- Supabase Auth, so `auth.uid()` is null inside Postgres.
--
-- SELECT and INSERT are deliberately untouched — reading is public and the
-- client still inserts comments directly.
drop policy if exists event_comments_update_all on public.event_comments;
drop policy if exists event_comments_delete_all on public.event_comments;

-- Take the grants back too, so the capability is gone at both layers rather
-- than only at the policy layer.
revoke update, delete on public.event_comments from anon, authenticated;
