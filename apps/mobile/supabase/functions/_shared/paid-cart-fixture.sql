
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
CREATE TABLE public.carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  event_id INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_pi_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID,
  user_id TEXT,
  guest_email TEXT,
  status TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
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
-- Stand-ins for the tier pricing helpers cart_create_hold calls.
CREATE FUNCTION public.ticket_type_current_price_cents(p_tier_id uuid) RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT price_cents FROM public.ticket_types WHERE id = p_tier_id $$;
CREATE FUNCTION public.ticket_type_available(p_tier_id uuid) RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT 1 $$;

CREATE TABLE events(id integer PRIMARY KEY,status text);
INSERT INTO events VALUES(1,'active');
ALTER TABLE carts ADD total_cents integer NOT NULL DEFAULT 1000;
ALTER TABLE cart_line_items ADD refunded_amount_cents integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD quantity integer DEFAULT 1, ADD event_id integer DEFAULT 1, ADD type text DEFAULT 'event_ticket', ADD currency text DEFAULT 'usd', ADD total_cents integer DEFAULT 1000, ADD refunded_at timestamptz, ADD last_event_at timestamptz, ADD created_at timestamptz DEFAULT now(), ADD stripe_checkout_session_id text, ADD checkout_failure_reason text, ADD checkout_failure_code text;
CREATE UNIQUE INDEX orders_one_cart ON orders(cart_id);
CREATE TABLE order_timeline(order_id uuid,type text);
CREATE FUNCTION fixture_assert(p_condition boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',p_message; END IF; END;$$;
CREATE FUNCTION fixture_paid_cart(p_kind text DEFAULT 'addon',p_capacity integer DEFAULT 10,p_quantity integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c uuid:=gen_random_uuid();o uuid:=gen_random_uuid();t uuid; a uuid;l uuid;tx jsonb:='[]';ax jsonb:='[]';pi text:='pi_'||c::text;u text:='buyer_'||c::text;i integer;
BEGIN
 INSERT INTO carts(id,user_id,event_id,status,stripe_pi_id,total_cents) VALUES(c,u,1,'abandoned',pi,1000);
 INSERT INTO orders(id,cart_id,user_id,event_id,status,stripe_payment_intent_id,total_cents,quantity,checkout_failure_reason,checkout_failure_code) VALUES(o,c,u,1,'payment_failed',pi,1000,p_quantity*CASE WHEN p_kind='mixed' THEN 2 ELSE 1 END,'payment_declined','generic_decline');
 IF p_kind IN ('admission','mixed') THEN
  INSERT INTO ticket_types(quantity_total,quantity_sold,event_id) VALUES(p_capacity,0,1) RETURNING id INTO t;
  INSERT INTO cart_line_items(cart_id,tier_id,quantity,unit_price_cents) VALUES(c,t,p_quantity,500) RETURNING id INTO l;
  INSERT INTO cart_holds(cart_id,line_item_id,tier_id,qty,expires_at,released) VALUES(c,l,t,p_quantity,now()-interval '1 minute',true);
  FOR i IN 1..p_quantity LOOP tx:=tx||jsonb_build_array(jsonb_build_object('ticket_id',gen_random_uuid(),'line_item_id',l,'qr_token',gen_random_uuid()::text,'qr_payload',gen_random_uuid()::text)); END LOOP;
 END IF;
 IF p_kind IN ('addon','mixed') THEN
  INSERT INTO ticket_addons(quantity_total,quantity_sold,event_id) VALUES(p_capacity,0,1) RETURNING id INTO a;
  INSERT INTO cart_line_items(cart_id,category,addon_id,quantity,unit_price_cents) VALUES(c,'addon',a,p_quantity,500) RETURNING id INTO l;
  INSERT INTO cart_holds(cart_id,line_item_id,addon_id,qty,expires_at,released) VALUES(c,l,a,p_quantity,now()-interval '1 minute',true);
  FOR i IN 1..p_quantity LOOP ax:=ax||jsonb_build_array(jsonb_build_object('line_item_id',l,'qr_token',gen_random_uuid()::text,'qr_payload',gen_random_uuid()::text)); END LOOP;
 END IF;
 RETURN jsonb_build_object('cart',c,'order',o,'pi',pi,'user',u,'tier',t,'addon',a,'tickets',tx,'addons',ax);
END;$$;
CREATE FUNCTION fixture_complete(f jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
 BEGIN RETURN complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,f->'tickets',f->'addons',now()); END;
$$;

-- Model the production attendance/financial event-lock dependency.
CREATE FUNCTION fixture_event_financial_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE events SET status=status WHERE id=NEW.event_id; RETURN NEW; END;$$;
CREATE TRIGGER fixture_ticket_event_refresh AFTER INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION fixture_event_financial_refresh();
CREATE TRIGGER fixture_addon_event_refresh AFTER INSERT ON order_addons FOR EACH ROW EXECUTE FUNCTION fixture_event_financial_refresh();
