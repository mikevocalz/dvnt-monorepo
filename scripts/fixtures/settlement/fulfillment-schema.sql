-- Synthetic tables matching columns used by the REAL paid ticket/cart issuers.
CREATE TABLE public.ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  quantity_total INTEGER,
  quantity_sold INTEGER DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'admission',
  status TEXT DEFAULT 'on_sale',
  tier_visibility TEXT DEFAULT 'public',
  unlock_code TEXT,
  unlocks_after_tier_id UUID,
  is_sold_out BOOLEAN DEFAULT false,
  price_cents INTEGER NOT NULL DEFAULT 2500
);
ALTER TABLE public.carts ADD user_id text, ADD event_id int, ADD status text DEFAULT 'draft', ADD currency text DEFAULT 'usd', ADD stripe_pi_id text, ADD total_cents int, ADD created_at timestamptz DEFAULT now(), ADD updated_at timestamptz DEFAULT now();
CREATE TABLE public.ticket_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'on_sale',
  requires_tier_id UUID,
  price_cents INTEGER NOT NULL DEFAULT 500,
  currency TEXT DEFAULT 'usd',
  is_redeemable BOOLEAN NOT NULL DEFAULT true,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.ticket_addon_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id),
  price_cents INTEGER,
  quantity_total INTEGER,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  quantity_held INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.cart_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.carts(id),
  category TEXT NOT NULL DEFAULT 'admission',
  tier_id UUID REFERENCES public.ticket_types(id),
  addon_id UUID REFERENCES public.ticket_addons(id),
  variant_id UUID REFERENCES public.ticket_addon_variants(id),
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE public.cart_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID,
  line_item_id UUID,
  tier_id UUID,
  addon_id UUID,
  variant_id UUID,
  qty INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  released BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ
);
CREATE TABLE public.ticket_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id UUID NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.orders ADD created_at timestamptz DEFAULT now(), ADD updated_at timestamptz DEFAULT now(), ADD refunded_at timestamptz, ADD sold_by_staff_user_id text, ADD checkout_failure_reason text, ADD checkout_failure_code text, ADD last_event_at timestamptz;
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL,
  ticket_type_id UUID,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  qr_token TEXT,
  qr_payload TEXT,
  stripe_payment_intent_id TEXT,
  purchase_amount_cents INTEGER,
  category TEXT,
  cart_id UUID,
  cart_line_item_id UUID,
  order_index INTEGER,
  order_count INTEGER,
  attendee_name TEXT,
  order_id UUID
);
CREATE TABLE public.order_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID,
  event_id INTEGER NOT NULL,
  addon_id UUID NOT NULL REFERENCES public.ticket_addons(id),
  variant_id UUID,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  cart_id UUID,
  cart_line_item_id UUID,
  user_id TEXT,
  guest_email TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER,
  refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled','fulfilled','redeemed','refunded')),
  qr_token TEXT,
  qr_payload TEXT,
  CONSTRAINT order_addons_owner CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);

ALTER TABLE public.tickets ADD guest_email text, ADD guest_name text, ADD guest_lookup_token text, ADD stripe_checkout_session_id text;
ALTER TABLE public.ticket_holds ADD payment_intent_id text, ADD event_id int, ADD user_id text, ADD guest_email text;
ALTER TABLE public.cart_line_items ADD refunded_amount_cents int DEFAULT 0;
CREATE TABLE public.order_timeline(order_id uuid,type text);

CREATE TABLE public.users(id bigint PRIMARY KEY,auth_id text);
ALTER TABLE public.ticket_types ADD max_per_user integer DEFAULT 0, ADD max_per_order integer DEFAULT 0;
