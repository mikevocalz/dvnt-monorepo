-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613232433 :: guest_commerce_groundwork). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Guest commerce groundwork (Phase 4.5 / 5.6) — purely additive.
alter table public.orders       add column if not exists guest_phone text;
alter table public.tickets      add column if not exists guest_phone text;
alter table public.order_addons add column if not exists guest_phone text;

alter table public.tickets add column if not exists rsvp_verified_at timestamptz;

create table if not exists public.rsvp_otp_codes (
  id           uuid primary key default gen_random_uuid(),
  event_id     bigint references public.events(id) on delete cascade,
  channel      text   not null check (channel in ('email','sms')),
  destination  text   not null,
  code_hash    text   not null,
  attempts     int    not null default 0,
  max_attempts int    not null default 5,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  request_ip   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_rsvp_otp_live
  on public.rsvp_otp_codes (destination, event_id)
  where consumed_at is null;
create index if not exists idx_rsvp_otp_dest_time
  on public.rsvp_otp_codes (destination, created_at desc);

alter table public.rsvp_otp_codes enable row level security;;
