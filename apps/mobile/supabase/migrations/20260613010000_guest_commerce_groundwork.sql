-- Guest commerce groundwork (Phase 4.5 / 5.6) — purely additive.
-- Adds the guest_phone delivery target (so the SMS channel has somewhere to
-- write when a provider lands), the free-RSVP OTP verification model, and the
-- rsvp_verified_at stamp. No drops, no data changes, no behavior change yet —
-- the edge functions that use these land in the next (gated) slice.

-- 1. guest_phone delivery target (orders is the source of truth; tickets mirrors
--    it for the per-child delivery in group orders). guest_email already exists.
alter table public.orders       add column if not exists guest_phone text;
alter table public.tickets      add column if not exists guest_phone text;
alter table public.order_addons add column if not exists guest_phone text;

-- 2. Free-RSVP proof-of-human: stamped when the OTP is verified. A free RSVP
--    ticket is the same row as a paid ticket (amount 0), keyed to guest contact.
alter table public.tickets add column if not exists rsvp_verified_at timestamptz;

-- 3. OTP store for guest RSVP (and future guest-checkout contact verification).
--    Only the hash of the 6-digit code is stored; service-role (edge fns) only.
create table if not exists public.rsvp_otp_codes (
  id           uuid primary key default gen_random_uuid(),
  event_id     bigint references public.events(id) on delete cascade,
  channel      text   not null check (channel in ('email','sms')),
  destination  text   not null,                 -- normalized email or E.164 phone
  code_hash    text   not null,                 -- sha256(code)
  attempts     int    not null default 0,
  max_attempts int    not null default 5,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  request_ip   text,
  created_at   timestamptz not null default now()
);

-- Fast lookup of the live (unconsumed) code for a destination+event, and a
-- destination-wide scan for rate limiting issuance.
create index if not exists idx_rsvp_otp_live
  on public.rsvp_otp_codes (destination, event_id)
  where consumed_at is null;
create index if not exists idx_rsvp_otp_dest_time
  on public.rsvp_otp_codes (destination, created_at desc);

-- Lock it down: no anon/authenticated access — the rsvp-verify edge function
-- (service role) is the only reader/writer. RLS on, zero policies = deny all.
alter table public.rsvp_otp_codes enable row level security;

-- The edge function runs as service_role; grant it access (new tables don't get
-- it automatically here). anon/authenticated remain ungranted → fully locked.
grant select, insert, update on public.rsvp_otp_codes to service_role;
