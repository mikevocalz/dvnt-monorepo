-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614220327 :: event_policy_fields). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Phase 5 policy gaps — per-event organizer policy fields the matrix flagged as
-- MISSING. Additive, safe defaults that preserve current behavior.

-- Named tickets (Eventbrite parity): off | optional | required.
alter table public.events add column if not exists attendee_name_requirement text
  not null default 'off';
alter table public.events drop constraint if exists events_attendee_name_req_chk;
alter table public.events add constraint events_attendee_name_req_chk
  check (attendee_name_requirement in ('off','optional','required'));

-- Refund policy (surfaced pre-purchase, enforced server-side):
--   none | before_event | days_before (uses refund_days_before) | always
alter table public.events add column if not exists refund_policy text
  not null default 'none';
alter table public.events add column if not exists refund_days_before int;
alter table public.events drop constraint if exists events_refund_policy_chk;
alter table public.events add constraint events_refund_policy_chk
  check (refund_policy in ('none','before_event','days_before','always'));

-- Fee handling: pass (buyer pays the service fee) | absorb (organizer eats it).
alter table public.events add column if not exists fee_mode text
  not null default 'pass';
alter table public.events drop constraint if exists events_fee_mode_chk;
alter table public.events add constraint events_fee_mode_chk
  check (fee_mode in ('pass','absorb'));;
