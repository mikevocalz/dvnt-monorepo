-- Host & Guest WS-3 (perk config) + WS-5 (arrival presence).
--
-- PERKS — one jsonb column on events rather than a side table. A perk config is
-- read on every roster row and every door scan and written once at event-edit;
-- a join would be paid thousands of times to save a write that happens once.
-- Shape is { perk_key: minimum PLAN_RANK }, with a key absent or null meaning
-- the perk is off. Ranks (not plan keys) so inserting a tier in the middle of
-- the ladder later does not require rewriting every event's config.
--
-- PRESENCE — discrete states only. There is deliberately NO latitude, longitude,
-- accuracy or geometry column anywhere in this table: the device evaluates the
-- venue radius locally and posts the resulting STATE. Coordinates never leave
-- the phone, so they cannot leak from here. Rows are event-scoped and expire.

-- ── WS-3 ────────────────────────────────────────────────────────────────────
alter table public.events
  add column if not exists perk_config jsonb;

comment on column public.events.perk_config is
  'Host & Guest WS-3. { perk_key: min PLAN_RANK }. Absent/null key = perk off. '
  'Defaults live in lib/perks/perk-config.ts; null here means "use defaults".';

-- ── WS-5 ────────────────────────────────────────────────────────────────────
create table if not exists public.event_presence (
  -- NO foreign key to events, deliberately. One here creates a SECOND
  -- relationship path from tickets to events (tickets -> event_presence ->
  -- events), which makes PostgREST reject the `events(...)` embed in
  -- get-my-tickets as ambiguous — that shipped and 500'd every ticket fetch
  -- until the constraint was dropped. Integrity is unaffected: ticket_id
  -- cascades from tickets, and tickets cascade from events.
  event_id    bigint not null,
  ticket_id   uuid   not null references public.tickets(id) on delete cascade,
  user_id     text   not null,
  -- approaching | arrived | departed. `checked_in` is deliberately NOT a
  -- presence state: the door owns that, via ticket-scan, and presence must
  -- never be mistaken for admission.
  state       text   not null check (state in ('approaching','arrived','departed')),
  updated_at  timestamptz not null default now(),
  -- Hard stop. Nothing survives past the operational window.
  expires_at  timestamptz not null,
  primary key (event_id, ticket_id)
);

comment on table public.event_presence is
  'Host & Guest WS-5. Discrete arrival states only — NO coordinates, by design. '
  'Consent is per-event and revocable; revocation deletes the row immediately.';

create index if not exists idx_event_presence_event_state
  on public.event_presence (event_id, state);

create index if not exists idx_event_presence_expiry
  on public.event_presence (expires_at);

alter table public.event_presence enable row level security;

-- Deny-by-default: no client role gets direct access. Reads go through
-- get-event-tickets / event-analytics (host, aggregate) and writes through the
-- presence edge function, both of which verify the session server-side.
revoke all on public.event_presence from anon, authenticated;

-- Housekeeping: drop expired rows. Idempotent, safe to call from anywhere.
create or replace function public.expire_event_presence()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.event_presence where expires_at < now();
$$;

revoke execute on function public.expire_event_presence() from anon, authenticated, public;
grant execute on function public.expire_event_presence() to service_role;
