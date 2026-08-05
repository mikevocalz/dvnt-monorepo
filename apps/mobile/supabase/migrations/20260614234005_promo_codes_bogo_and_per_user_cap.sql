-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614234005 :: promo_codes_bogo_and_per_user_cap). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Phase 5 promo gaps: BOGO discount type + per-user usage cap.
alter table public.promo_codes add column if not exists max_per_user int;

-- Widen the discount_type check to include 'bogo'.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid='public.promo_codes'::regclass and contype='c'
    and pg_get_constraintdef(oid) ilike '%discount_type%' limit 1;
  if cname is not null then
    execute format('alter table public.promo_codes drop constraint %I', cname);
  end if;
end $$;
alter table public.promo_codes add constraint promo_codes_discount_type_check
  check (discount_type in ('percent','fixed_cents','bogo'));;
