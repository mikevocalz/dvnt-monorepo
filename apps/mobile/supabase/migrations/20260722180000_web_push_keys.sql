-- Web push (PWA): VAPID keypair storage — RLS deny-all, service-role only.
-- Applied 2026-07-22 via psql (values inserted out-of-band, never committed).
create table if not exists public.web_push_keys (
  id int primary key default 1,
  public_key text not null,
  private_key text not null,
  subject text not null default 'mailto:DeviantEventsDC@gmail.com'
);
alter table public.web_push_keys enable row level security;
revoke all on public.web_push_keys from anon, authenticated;
