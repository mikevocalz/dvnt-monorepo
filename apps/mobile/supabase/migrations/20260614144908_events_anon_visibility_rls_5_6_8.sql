-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614144908 :: events_anon_visibility_rls_5_6_8). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Phase 5.6.8 — the part that must not leak. Logged-out (anon) users may only
-- read PUBLIC + LINK_ONLY events; PRIVATE events are invisible to them (no
-- existence leak via discovery, direct id, OG, or the guest endpoints).
-- Authenticated behavior is preserved unchanged (the app mints a Supabase JWT
-- with role=authenticated). service_role (edge fns) bypasses RLS.

-- SELECT: replace the blanket "everyone sees everything" with role-split policies.
drop policy if exists "Events viewable by everyone" on public.events;

create policy "events_select_anon" on public.events
  for select to anon
  using (visibility in ('public', 'link_only'));

create policy "events_select_authenticated" on public.events
  for select to authenticated
  using (true);

-- INSERT: anon must never create events (was role=public → included anon).
drop policy if exists "Anyone can create events" on public.events;

create policy "events_insert_authenticated" on public.events
  for insert to authenticated
  with check (true);

-- Belt-and-suspenders: anon holds stale write grants; RLS already denies anon
-- writes (no anon write policy), but drop the privileges so it's defense-in-depth.
revoke insert, update, delete on public.events from anon;;
