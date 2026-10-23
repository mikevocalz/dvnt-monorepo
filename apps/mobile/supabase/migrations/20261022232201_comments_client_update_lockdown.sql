-- Close the unused direct-client comment UPDATE capability. Better Auth
-- sessions are verified by Edge Functions; auth.uid() is not the app identity.
-- No shipped comment editor writes this table. Service-role writes (including
-- likes counters) and public reads remain unchanged. No production data writes.
begin;

revoke update on table public.comments from public, anon, authenticated;

-- Table REVOKE alone does not remove explicit column UPDATE grants. Iterate
-- catalog columns so this also protects attachment when the GIF migration is
-- installed first, without depending on that optional column.
do $$
declare col text;
begin
  for col in
    select attname from pg_attribute
    where attrelid = 'public.comments'::regclass
      and attnum > 0 and not attisdropped
  loop
    execute format(
      'revoke update (%I) on public.comments from public, anon, authenticated',
      col
    );
  end loop;
end
$$;

-- Observed in the read-only production catalog on 2026-10-22. Remove only
-- this known permissive policy; do not replace unrelated INSERT/DELETE rules.
drop policy if exists comments_update_anon on public.comments;

commit;
