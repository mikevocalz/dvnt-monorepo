-- ============================================================
-- DVNT Mixed-Cart Checkout
-- Admission + coat-check line items in one Stripe PaymentIntent.
-- ============================================================

-- ── 1. Normalize category support without removing legacy categories ─────
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'ticket_types'
  ) then
    alter table public.ticket_types
      add column if not exists category text default 'admission';

    update public.ticket_types
    set category = 'admission'
    where category is null;

    alter table public.ticket_types
      alter column category set not null;

    alter table public.ticket_types
      drop constraint if exists ticket_types_category_check;

    alter table public.ticket_types
      add constraint ticket_types_category_check
      check (category in ('admission', 'coat_check', 'product', 'service'));

    create index if not exists idx_ticket_types_event_category
      on public.ticket_types(event_id, category);
  end if;
end $$;

alter table public.tickets
  add column if not exists category text default 'admission',
  add column if not exists cart_id uuid,
  add column if not exists cart_line_item_id uuid,
  add column if not exists qr_payload text;

update public.tickets
set category = 'admission'
where category is null;

alter table public.tickets
  alter column category set not null;

alter table public.tickets
  drop constraint if exists tickets_category_check;

alter table public.tickets
  add constraint tickets_category_check
  check (category in ('admission', 'coat_check', 'product', 'service'));

create index if not exists idx_tickets_category
  on public.tickets(event_id, category, status);

-- ── 2. Cart tables ──────────────────────────────────────────
create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  event_id integer not null references public.events(id) on delete cascade,
  status text not null default 'draft',
  stripe_pi_id text,
  total_cents integer not null default 0,
  fee_cents integer not null default 0,
  tax_cents integer not null default 0,
  currency text not null default 'usd',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_status_check
    check (status in ('draft', 'holding', 'paying', 'completed', 'abandoned')),
  constraint carts_amounts_nonnegative
    check (total_cents >= 0 and fee_cents >= 0 and tax_cents >= 0),
  constraint carts_currency_lowercase
    check (currency = lower(currency) and length(currency) = 3)
);

create unique index if not exists idx_carts_idempotency_key
  on public.carts(idempotency_key);
create unique index if not exists idx_carts_stripe_pi_id
  on public.carts(stripe_pi_id)
  where stripe_pi_id is not null;
create index if not exists idx_carts_user_status
  on public.carts(user_id, status, updated_at desc);
create index if not exists idx_carts_event
  on public.carts(event_id);

create table if not exists public.cart_line_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  category text not null,
  tier_id uuid not null references public.ticket_types(id) on delete restrict,
  quantity integer not null,
  unit_price_cents integer not null,
  refunded_amount_cents integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_line_items_category_check
    check (category in ('admission', 'coat_check')),
  constraint cart_line_items_quantity_positive
    check (quantity > 0),
  constraint cart_line_items_amounts_nonnegative
    check (unit_price_cents >= 0 and refunded_amount_cents >= 0)
);

create index if not exists idx_cart_line_items_cart
  on public.cart_line_items(cart_id);
create index if not exists idx_cart_line_items_tier
  on public.cart_line_items(tier_id);
create index if not exists idx_cart_line_items_category
  on public.cart_line_items(cart_id, category);

create table if not exists public.cart_holds (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  line_item_id uuid not null references public.cart_line_items(id) on delete cascade,
  tier_id uuid not null references public.ticket_types(id) on delete restrict,
  qty integer not null,
  expires_at timestamptz not null,
  released boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cart_holds_qty_positive
    check (qty > 0)
);

create unique index if not exists idx_cart_holds_active_line_item
  on public.cart_holds(line_item_id)
  where released = false;
create index if not exists idx_cart_holds_cart_active
  on public.cart_holds(cart_id)
  where released = false;
create index if not exists idx_cart_holds_tier_active
  on public.cart_holds(tier_id, expires_at)
  where released = false;
create index if not exists idx_cart_holds_expires
  on public.cart_holds(expires_at)
  where released = false;

create table if not exists public.cart_line_refunds (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  line_item_id uuid not null references public.cart_line_items(id) on delete restrict,
  stripe_refund_id text,
  stripe_payment_intent_id text not null,
  amount_cents integer not null,
  idempotency_key text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_line_refunds_amount_positive
    check (amount_cents > 0),
  constraint cart_line_refunds_status_check
    check (status in ('pending', 'succeeded', 'failed'))
);

create unique index if not exists idx_cart_line_refunds_idempotency
  on public.cart_line_refunds(idempotency_key);
create unique index if not exists idx_cart_line_refunds_stripe_refund
  on public.cart_line_refunds(stripe_refund_id)
  where stripe_refund_id is not null;
create index if not exists idx_cart_line_refunds_line_item
  on public.cart_line_refunds(line_item_id);

-- Add foreign keys after cart tables exist. Constraint names are explicit for
-- idempotent re-runs in local rebuilds.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tickets_cart_id_fkey'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_cart_id_fkey
      foreign key (cart_id) references public.carts(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'tickets_cart_line_item_id_fkey'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_cart_line_item_id_fkey
      foreign key (cart_line_item_id)
      references public.cart_line_items(id) on delete set null;
  end if;
end $$;

create index if not exists idx_tickets_cart
  on public.tickets(cart_id)
  where cart_id is not null;
create index if not exists idx_tickets_cart_line_item
  on public.tickets(cart_line_item_id)
  where cart_line_item_id is not null;

alter table public.orders
  add column if not exists cart_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_cart_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_cart_id_fkey
      foreign key (cart_id) references public.carts(id) on delete set null;
  end if;
end $$;

drop index if exists public.idx_orders_cart_id;
create unique index idx_orders_cart_id
  on public.orders(cart_id);

-- ── 3. Updated timestamps ──────────────────────────────────
create or replace function public.set_mixed_cart_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_carts_updated_at on public.carts;
create trigger trg_carts_updated_at
  before update on public.carts
  for each row
  execute function public.set_mixed_cart_updated_at();

drop trigger if exists trg_cart_line_items_updated_at on public.cart_line_items;
create trigger trg_cart_line_items_updated_at
  before update on public.cart_line_items
  for each row
  execute function public.set_mixed_cart_updated_at();

drop trigger if exists trg_cart_line_refunds_updated_at on public.cart_line_refunds;
create trigger trg_cart_line_refunds_updated_at
  before update on public.cart_line_refunds
  for each row
  execute function public.set_mixed_cart_updated_at();

-- ── 4. Atomic cart hold RPCs ────────────────────────────────
create or replace function public.cart_create_hold(
  p_cart_id uuid,
  p_hold_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart public.carts%rowtype;
  v_line record;
  v_line_count integer := 0;
  v_expires_at timestamptz :=
    now() + make_interval(secs => greatest(60, least(coalesce(p_hold_seconds, 600), 3600)));
  v_active_cart_hold_qty integer;
  v_active_legacy_hold_qty integer;
  v_available integer;
begin
  select *
  into v_cart
  from public.carts
  where id = p_cart_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cart_not_found');
  end if;

  if v_cart.status = 'completed' then
    return jsonb_build_object('ok', false, 'error', 'cart_completed');
  end if;

  update public.cart_holds
  set released = true,
      released_at = now()
  where cart_id = p_cart_id
    and released = false;

  for v_line in
    select
      cli.id,
      cli.cart_id,
      cli.category,
      cli.tier_id,
      cli.quantity,
      tt.event_id as tier_event_id,
      tt.price_cents,
      tt.currency,
      tt.quantity_total,
      tt.quantity_sold,
      tt.category as tier_category
    from public.cart_line_items cli
    join public.ticket_types tt on tt.id = cli.tier_id
    where cli.cart_id = p_cart_id
    order by cli.id
    for update of cli, tt
  loop
    v_line_count := v_line_count + 1;

    if v_line.tier_event_id <> v_cart.event_id then
      return jsonb_build_object(
        'ok', false,
        'error', 'line_item_event_mismatch',
        'lineItemId', v_line.id,
        'tierId', v_line.tier_id
      );
    end if;

    if lower(v_line.currency) <> lower(v_cart.currency) then
      return jsonb_build_object(
        'ok', false,
        'error', 'currency_mismatch',
        'lineItemId', v_line.id,
        'tierId', v_line.tier_id
      );
    end if;

    if v_line.category = 'admission' and v_line.tier_category <> 'admission' then
      return jsonb_build_object(
        'ok', false,
        'error', 'category_mismatch',
        'lineItemId', v_line.id,
        'tierId', v_line.tier_id
      );
    end if;

    if v_line.category = 'coat_check'
      and v_line.tier_category not in ('coat_check', 'service')
    then
      return jsonb_build_object(
        'ok', false,
        'error', 'category_mismatch',
        'lineItemId', v_line.id,
        'tierId', v_line.tier_id
      );
    end if;

    update public.cart_line_items
    set unit_price_cents = v_line.price_cents
    where id = v_line.id;

    if v_line.quantity_total is not null then
      select coalesce(sum(ch.qty), 0)
      into v_active_cart_hold_qty
      from public.cart_holds ch
      where ch.tier_id = v_line.tier_id
        and ch.released = false
        and ch.expires_at > now();

      select coalesce(sum(th.quantity), 0)
      into v_active_legacy_hold_qty
      from public.ticket_holds th
      where th.ticket_type_id = v_line.tier_id
        and th.status = 'active'
        and th.expires_at > now();

      v_available :=
        v_line.quantity_total
        - coalesce(v_line.quantity_sold, 0)
        - coalesce(v_active_cart_hold_qty, 0)
        - coalesce(v_active_legacy_hold_qty, 0);

      if v_available < v_line.quantity then
        return jsonb_build_object(
          'ok', false,
          'error', 'insufficient_capacity',
          'lineItemId', v_line.id,
          'tierId', v_line.tier_id,
          'available', greatest(v_available, 0)
        );
      end if;
    end if;

    insert into public.cart_holds (
      cart_id,
      line_item_id,
      tier_id,
      qty,
      expires_at
    ) values (
      p_cart_id,
      v_line.id,
      v_line.tier_id,
      v_line.quantity,
      v_expires_at
    );
  end loop;

  if v_line_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;

  update public.carts
  set status = 'holding'
  where id = p_cart_id;

  return jsonb_build_object(
    'ok', true,
    'holdExpiresAt', v_expires_at
  );
end;
$$;

create or replace function public.cart_release_hold(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released_count integer;
begin
  update public.cart_holds
  set released = true,
      released_at = now()
  where cart_id = p_cart_id
    and released = false;

  get diagnostics v_released_count = row_count;

  update public.carts
  set status = 'abandoned'
  where id = p_cart_id
    and status in ('draft', 'holding', 'paying');

  return jsonb_build_object('ok', true, 'releasedCount', v_released_count);
end;
$$;

create or replace function public.cart_release_expired_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released_count integer;
  v_abandoned_count integer;
begin
  update public.cart_holds
  set released = true,
      released_at = now()
  where released = false
    and expires_at <= now();

  get diagnostics v_released_count = row_count;

  update public.carts
  set status = 'abandoned'
  where status in ('draft', 'holding')
    and updated_at < now() - interval '24 hours';

  get diagnostics v_abandoned_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'releasedCount', v_released_count,
    'abandonedCount', v_abandoned_count
  );
end;
$$;

create or replace function public.cart_complete_issuance(
  p_cart_id uuid,
  p_payment_intent_id text,
  p_ticket_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart public.carts%rowtype;
  v_line record;
  v_prepared record;
  v_issued_count integer := 0;
  v_existing_count integer := 0;
  v_hold_count integer := 0;
  v_expected_count integer := 0;
  v_prepared_count integer := 0;
  v_line_prepared_count integer := 0;
begin
  select *
  into v_cart
  from public.carts
  where id = p_cart_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cart_not_found');
  end if;

  if v_cart.status = 'completed' then
    select count(*)
    into v_existing_count
    from public.tickets
    where cart_id = p_cart_id;

    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'issuedCount', v_existing_count
    );
  end if;

  if v_cart.status not in ('holding', 'paying') then
    return jsonb_build_object(
      'ok', false,
      'error', 'cart_not_ready',
      'status', v_cart.status
    );
  end if;

  if v_cart.stripe_pi_id is not null and v_cart.stripe_pi_id <> p_payment_intent_id then
    return jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
  end if;

  if jsonb_typeof(p_ticket_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows');
  end if;

  select coalesce(sum(quantity), 0)
  into v_expected_count
  from public.cart_line_items
  where cart_id = p_cart_id;

  select count(*)
  into v_prepared_count
  from jsonb_to_recordset(p_ticket_rows) as prepared(
    ticket_id uuid,
    line_item_id uuid,
    qr_token text,
    qr_payload text
  );

  if v_expected_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;

  if v_prepared_count <> v_expected_count then
    return jsonb_build_object(
      'ok', false,
      'error', 'prepared_ticket_count_mismatch',
      'expected', v_expected_count,
      'actual', v_prepared_count
    );
  end if;

  select count(*)
  into v_hold_count
  from public.cart_holds ch
  join public.cart_line_items cli on cli.id = ch.line_item_id
  where ch.cart_id = p_cart_id
    and cli.cart_id = p_cart_id
    and ch.released = false
    and ch.expires_at > now();

  if v_hold_count <> (
    select count(*) from public.cart_line_items where cart_id = p_cart_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'hold_expired');
  end if;

  for v_line in
    select
      cli.id as line_item_id,
      cli.category,
      cli.tier_id,
      cli.quantity,
      tt.event_id,
      tt.price_cents
    from public.cart_line_items cli
    join public.ticket_types tt on tt.id = cli.tier_id
    where cli.cart_id = p_cart_id
    order by cli.id
    for update of cli, tt
  loop
    if v_line.event_id <> v_cart.event_id then
      return jsonb_build_object(
        'ok', false,
        'error', 'line_item_event_mismatch',
        'lineItemId', v_line.line_item_id
      );
    end if;

    select count(*)
    into v_line_prepared_count
    from jsonb_to_recordset(p_ticket_rows) as prepared(
      ticket_id uuid,
      line_item_id uuid,
      qr_token text,
      qr_payload text
    )
    where prepared.line_item_id = v_line.line_item_id;

    if v_line_prepared_count <> v_line.quantity then
      return jsonb_build_object(
        'ok', false,
        'error', 'prepared_line_item_count_mismatch',
        'lineItemId', v_line.line_item_id,
        'expected', v_line.quantity,
        'actual', v_line_prepared_count
      );
    end if;

    for v_prepared in
      select *
      from jsonb_to_recordset(p_ticket_rows) as prepared(
        ticket_id uuid,
        line_item_id uuid,
        qr_token text,
        qr_payload text
      )
      where prepared.line_item_id = v_line.line_item_id
    loop
      if v_prepared.ticket_id is null
        or v_prepared.qr_token is null
        or length(v_prepared.qr_token) = 0
        or v_prepared.qr_payload is null
        or length(v_prepared.qr_payload) = 0
      then
        return jsonb_build_object(
          'ok', false,
          'error', 'invalid_prepared_ticket',
          'lineItemId', v_line.line_item_id
        );
      end if;

      insert into public.tickets (
        id,
        event_id,
        ticket_type_id,
        user_id,
        status,
        qr_token,
        qr_payload,
        stripe_payment_intent_id,
        purchase_amount_cents,
        category,
        cart_id,
        cart_line_item_id
      ) values (
        v_prepared.ticket_id,
        v_line.event_id,
        v_line.tier_id,
        v_cart.user_id,
        'active',
        v_prepared.qr_token,
        v_prepared.qr_payload,
        p_payment_intent_id,
        v_line.price_cents,
        v_line.category,
        p_cart_id,
        v_line.line_item_id
      );

      v_issued_count := v_issued_count + 1;
    end loop;

    update public.ticket_types
    set quantity_sold = coalesce(quantity_sold, 0) + v_line.quantity
    where id = v_line.tier_id;
  end loop;

  if v_issued_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty_cart');
  end if;

  update public.cart_holds
  set released = true,
      released_at = now()
  where cart_id = p_cart_id
    and released = false;

  update public.carts
  set status = 'completed',
      stripe_pi_id = p_payment_intent_id
  where id = p_cart_id;

  update public.orders
  set status = 'paid',
      stripe_payment_intent_id = p_payment_intent_id,
      paid_at = now(),
      updated_at = now()
  where cart_id = p_cart_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'issuedCount', v_issued_count
  );
end;
$$;

revoke all on function public.cart_create_hold(uuid, integer) from public;
revoke all on function public.cart_release_hold(uuid) from public;
revoke all on function public.cart_release_expired_holds() from public;
revoke all on function public.cart_complete_issuance(uuid, text, jsonb) from public;
grant execute on function public.cart_create_hold(uuid, integer) to service_role;
grant execute on function public.cart_release_hold(uuid) to service_role;
grant execute on function public.cart_release_expired_holds() to service_role;
grant execute on function public.cart_complete_issuance(uuid, text, jsonb) to service_role;

-- Schedule cleanup when pg_cron is available in the environment. Supabase
-- projects without pg_cron still deploy cleanly; the edge function can call
-- cart_release_expired_holds manually until cron is enabled.
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('cart-hold-cleanup')$$;
    exception
      when others then
        null;
    end;

    execute $$select cron.schedule(
      'cart-hold-cleanup',
      '*/5 * * * *',
      'select public.cart_release_expired_holds();'
    )$$;
  end if;
end $cron$;

-- ── 5. RLS and grants ──────────────────────────────────────
grant all on public.carts to service_role;
grant all on public.cart_line_items to service_role;
grant all on public.cart_holds to service_role;
grant all on public.cart_line_refunds to service_role;
grant all on public.tickets to service_role;
grant all on public.orders to service_role;
grant all on public.ticket_types to service_role;

grant select on public.carts to authenticated;
grant select on public.cart_line_items to authenticated;
grant select on public.cart_holds to authenticated;
grant select on public.cart_line_refunds to authenticated;

revoke all on public.carts from anon;
revoke all on public.cart_line_items from anon;
revoke all on public.cart_holds from anon;
revoke all on public.cart_line_refunds from anon;

alter table public.carts enable row level security;
alter table public.cart_line_items enable row level security;
alter table public.cart_holds enable row level security;
alter table public.cart_line_refunds enable row level security;

drop policy if exists carts_select_owner on public.carts;
create policy carts_select_owner
  on public.carts
  for select
  to authenticated
  using (
    user_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );

drop policy if exists cart_line_items_select_owner on public.cart_line_items;
create policy cart_line_items_select_owner
  on public.cart_line_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_line_items.cart_id
        and c.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

drop policy if exists cart_holds_select_owner on public.cart_holds;
create policy cart_holds_select_owner
  on public.cart_holds
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_holds.cart_id
        and c.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

drop policy if exists cart_line_refunds_select_owner on public.cart_line_refunds;
create policy cart_line_refunds_select_owner
  on public.cart_line_refunds
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.carts c
      where c.id = cart_line_refunds.cart_id
        and c.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

notify pgrst, 'reload schema';
