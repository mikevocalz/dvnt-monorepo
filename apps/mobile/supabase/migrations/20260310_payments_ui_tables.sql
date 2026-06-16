-- ============================================================
-- DVNT Payments UI — Additive tables for receipts, branding, orders
-- No existing columns dropped or renamed
-- ============================================================

-- ── 1. Orders (unified purchase record) ──────────────────────
-- Consolidates ticket purchases, promotion purchases, sneaky access
-- into a single queryable table for the Purchases screen.
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('event_ticket', 'promotion', 'sneaky_access')),
  status text DEFAULT 'created' CHECK (status IN (
    'created', 'payment_pending', 'payment_failed', 'paid',
    'partially_refunded', 'refunded', 'disputed'
  )),
  currency text DEFAULT 'usd',
  subtotal_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer DEFAULT 0,
  processing_fee_cents integer DEFAULT 0,
  tax_cents integer DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  -- Stripe references
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  payment_method_last4 text,
  payment_method_brand text,
  -- Entity references
  event_id integer REFERENCES events(id),
  campaign_id integer,
  -- Receipt / invoice
  receipt_generated boolean DEFAULT false,
  receipt_pdf_path text,
  invoice_pdf_path text,
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  paid_at timestamptz,
  refunded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_event ON orders(event_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_pi ON orders(stripe_payment_intent_id);

-- ── 2. Order timeline events ─────────────────────────────────
CREATE TABLE IF NOT EXISTS order_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'created', 'payment_authorized', 'payment_captured',
    'receipt_generated', 'refund_requested', 'refund_processed',
    'dispute_opened', 'dispute_resolved'
  )),
  label text NOT NULL,
  detail text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_timeline_order ON order_timeline(order_id);

-- ── 3. Refund requests ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'denied', 'processed'
  )),
  reason text NOT NULL CHECK (reason IN (
    'duplicate', 'fraudulent', 'requested_by_customer', 'other'
  )),
  notes text,
  amount_cents integer,
  stripe_refund_id text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_order ON refund_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_user ON refund_requests(user_id);

-- ── 4. Organizer branding ────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizer_branding (
  host_id text PRIMARY KEY,
  logo_url text,
  logo_monochrome_url text,
  display_name text,
  fallback_text text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── 5. Stripe customers (map DVNT user → Stripe customer) ───
CREATE TABLE IF NOT EXISTS stripe_customers (
  user_id text PRIMARY KEY,
  stripe_customer_id text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ── Grants ───────────────────────────────────────────────────
GRANT SELECT ON orders TO authenticated;
GRANT SELECT ON order_timeline TO authenticated;
GRANT SELECT, INSERT ON refund_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON organizer_branding TO authenticated;
GRANT SELECT ON stripe_customers TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select_own"
  ON orders FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE order_timeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_timeline_select_own"
  ON order_timeline FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_timeline.order_id
        AND o.user_id = current_setting('request.jwt.claims', true)::json->>'sub'
    )
  );

ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "refund_requests_own"
  ON refund_requests FOR ALL
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE organizer_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizer_branding_own"
  ON organizer_branding FOR ALL
  USING (host_id = current_setting('request.jwt.claims', true)::json->>'sub');

ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_customers_own"
  ON stripe_customers FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');
