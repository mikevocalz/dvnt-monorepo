-- Platform-owned Stripe Terminal Locations for Tap to Pay. Under separate
-- charges and transfers the platform owns PaymentIntents and Locations, so
-- this maps an event to the Location its door staff collect against.
-- service_role only — clients never read or write this table.
create table if not exists public.event_terminal_locations (
  event_id bigint primary key references public.events(id) on delete cascade,
  stripe_location_id text not null,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.event_terminal_locations enable row level security;
revoke all on public.event_terminal_locations from public, anon, authenticated;
grant select, insert, update, delete on public.event_terminal_locations to service_role;
