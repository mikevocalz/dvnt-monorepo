-- ════════════════════════════════════════════════════════════════════════
-- Add-ons (Eventbrite add-ons, Posh upsells). The upsell layer: inventory-bound
-- items attached at checkout or post-purchase. Mirrors the ticket_types/tickets
-- + cart_holds inventory model. Additive + idempotent.
--
-- Relationship to the existing mixed cart: that flow modeled coarse add-ons as
-- ticket_types rows with category='product'/'service'. These tables are the
-- richer domain (variant matrix, binding modes, per-ticket binding, redeemable
-- state machine); the checkout edge fn bridges add-on cart lines to order_addons.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Add-on definitions
CREATE TABLE IF NOT EXISTS public.ticket_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  addon_type text NOT NULL DEFAULT 'merch'
    CHECK (addon_type IN ('merch','coat_check','drink_package','parking','skip_line','meet_greet','donation')),
  -- per_ticket: must buy 1 per ticket; per_order: one per cart; standalone: buyable without a ticket
  binding_mode text NOT NULL DEFAULT 'standalone'
    CHECK (binding_mode IN ('per_ticket','per_order','standalone')),
  price_cents integer NOT NULL DEFAULT 0,
  min_price_cents integer,                 -- donation floor
  currency text NOT NULL DEFAULT 'usd',
  -- Inventory at the add-on level (NULL when has_variants — inventory lives on variants).
  quantity_total integer,
  quantity_sold integer NOT NULL DEFAULT 0,
  quantity_held integer NOT NULL DEFAULT 0,
  has_variants boolean NOT NULL DEFAULT false,
  -- Gating: requires a specific tier (e.g. VIP-only meet & greet).
  requires_tier_id uuid REFERENCES public.ticket_types(id) ON DELETE SET NULL,
  -- Scan-at-door redeemable (skip-line, drink package) vs fulfilment-only (merch).
  is_redeemable boolean NOT NULL DEFAULT false,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'on_sale'
    CHECK (status IN ('draft','on_sale','paused','sold_out','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_addons_qty_nonneg CHECK (quantity_sold >= 0 AND quantity_held >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ticket_addons_event ON public.ticket_addons(event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_addons_requires_tier ON public.ticket_addons(requires_tier_id) WHERE requires_tier_id IS NOT NULL;

-- ── 2. Variant matrix (merch size × color, each its own inventory row)
CREATE TABLE IF NOT EXISTS public.ticket_addon_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id uuid NOT NULL REFERENCES public.ticket_addons(id) ON DELETE CASCADE,
  name text NOT NULL,                       -- display, e.g. "M / Black"
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {size:"M", color:"Black"}
  price_cents integer,                      -- override; NULL inherits addon.price_cents
  quantity_total integer,
  quantity_sold integer NOT NULL DEFAULT 0,
  quantity_held integer NOT NULL DEFAULT 0,
  sku text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addon_variant_qty_nonneg CHECK (quantity_sold >= 0 AND quantity_held >= 0)
);
CREATE INDEX IF NOT EXISTS idx_addon_variants_addon ON public.ticket_addon_variants(addon_id);

-- ── 3. Purchased add-ons + their state machine
--    UNFULFILLED → FULFILLED → REFUNDED, plus REDEEMED for scan-at-door items.
CREATE TABLE IF NOT EXISTS public.order_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.ticket_addons(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.ticket_addon_variants(id) ON DELETE RESTRICT,
  -- per_ticket binding attaches to a specific ticket; else NULL.
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  cart_id uuid,
  cart_line_item_id uuid,
  user_id text,                             -- buyer (matches tickets.user_id text type)
  guest_email text,                         -- guest buyer (mirrors tickets/orders)
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer NOT NULL DEFAULT 0,
  refunded_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unfulfilled'
    CHECK (status IN ('unfulfilled','fulfilled','redeemed','refunded')),
  -- scan-at-door redeemable add-ons get their own HMAC payload (same model as tickets.qr_payload)
  qr_token text,
  qr_payload text,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_addons_owner CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_order_addons_order  ON public.order_addons(order_id);
CREATE INDEX IF NOT EXISTS idx_order_addons_event  ON public.order_addons(event_id);
CREATE INDEX IF NOT EXISTS idx_order_addons_addon  ON public.order_addons(addon_id);
CREATE INDEX IF NOT EXISTS idx_order_addons_ticket ON public.order_addons(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_addons_user   ON public.order_addons(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_addons_guest  ON public.order_addons(guest_email) WHERE guest_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_addons_cart_line ON public.order_addons(cart_line_item_id) WHERE cart_line_item_id IS NOT NULL;

-- ── 4. Available-inventory helpers (mirror ticket_type_available)
CREATE OR REPLACE FUNCTION public.addon_available(p_addon_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.quantity_total IS NULL THEN 2147483647
    ELSE GREATEST(0, a.quantity_total - COALESCE(a.quantity_sold,0) - COALESCE(a.quantity_held,0))
  END FROM public.ticket_addons a WHERE a.id = p_addon_id;
$$;

CREATE OR REPLACE FUNCTION public.addon_variant_available(p_variant_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN v.quantity_total IS NULL THEN 2147483647
    ELSE GREATEST(0, v.quantity_total - COALESCE(v.quantity_sold,0) - COALESCE(v.quantity_held,0))
  END FROM public.ticket_addon_variants v WHERE v.id = p_variant_id;
$$;

-- ── 5. RLS — definitions are publicly readable (like tier definitions on public
--    events); purchases (order_addons) are owner/guest-scoped; writes via service role.
ALTER TABLE public.ticket_addons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_addon_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_addons          ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Add-on + variant definitions: readable by anyone (event-page render). Writes
  -- happen through edge functions using the service role (bypasses RLS).
  DROP POLICY IF EXISTS addons_public_read ON public.ticket_addons;
  CREATE POLICY addons_public_read ON public.ticket_addons FOR SELECT USING (true);

  DROP POLICY IF EXISTS addon_variants_public_read ON public.ticket_addon_variants;
  CREATE POLICY addon_variants_public_read ON public.ticket_addon_variants FOR SELECT USING (true);

  -- Purchased add-ons: a signed-in buyer sees their own; guest rows are reached
  -- only via the service-role guest-ticket function (no anon SELECT path here).
  DROP POLICY IF EXISTS order_addons_owner_read ON public.order_addons;
  CREATE POLICY order_addons_owner_read ON public.order_addons FOR SELECT
    USING (user_id = (auth.jwt() ->> 'sub'));
EXCEPTION WHEN others THEN NULL; END $$;
