-- B2 (PROMPT NN): server-side mirror of the onboarding Zustand store so
-- progress survives devices/reinstalls. Applied 2026-07-22 via psql.
-- Nullable, no constraints — display/progress data never gates a write.
-- RLS: own-row via the Better Auth → Supabase JWT bridge (auth.uid() = the
-- Better Auth user id on both web accessToken and native setSession paths).
create table if not exists public.onboarding_state (
  auth_id text primary key,
  current_step text,
  state jsonb,
  updated_at timestamptz not null default now()
);
alter table public.onboarding_state enable row level security;
create policy onboarding_state_own_select on public.onboarding_state
  for select to authenticated using (auth.uid()::text = auth_id);
create policy onboarding_state_own_insert on public.onboarding_state
  for insert to authenticated with check (auth.uid()::text = auth_id);
create policy onboarding_state_own_update on public.onboarding_state
  for update to authenticated using (auth.uid()::text = auth_id);
grant select, insert, update on public.onboarding_state to authenticated;
