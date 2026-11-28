-- Synthetic local-only catalog matching the columns used by actual inventory RPCs.
ALTER TABLE public.events ADD COLUMN fee_mode text DEFAULT 'pass', ADD COLUMN visibility text DEFAULT 'public',
 ADD COLUMN is_hidden boolean DEFAULT false, ADD COLUMN publish_at timestamptz;
ALTER TABLE public.carts ADD COLUMN user_id text,ADD COLUMN event_id int REFERENCES public.events(id),ADD COLUMN status text DEFAULT 'draft',
 ADD COLUMN stripe_pi_id text UNIQUE,ADD COLUMN total_cents int DEFAULT 0,ADD COLUMN fee_cents int DEFAULT 0,ADD COLUMN tax_cents int DEFAULT 0,
 ADD COLUMN currency text DEFAULT 'usd',ADD COLUMN idempotency_key text UNIQUE;
CREATE TABLE public.users(id text PRIMARY KEY,auth_id text);
CREATE TABLE public.ticket_types(id uuid PRIMARY KEY,event_id int REFERENCES public.events(id),price_cents int,currency text DEFAULT 'usd',
 category text DEFAULT 'admission',status text DEFAULT 'on_sale',is_active boolean DEFAULT true,tier_visibility text DEFAULT 'public',
 sale_start timestamptz,sale_end timestamptz,price_schedule jsonb DEFAULT '[]',sub_allocations jsonb DEFAULT '[]',
 quantity_total int,quantity_sold int DEFAULT 0,max_per_user int,max_per_order int,unlock_code text,unlocks_after_tier_id uuid,is_sold_out boolean DEFAULT false);
CREATE TABLE public.ticket_addons(id uuid PRIMARY KEY,event_id int,name text,status text DEFAULT 'on_sale',currency text DEFAULT 'usd',price_cents int,
 quantity_total int,quantity_sold int DEFAULT 0,quantity_held int DEFAULT 0,requires_tier_id uuid,binding_mode text DEFAULT 'standalone',addon_type text DEFAULT 'merch');
CREATE TABLE public.ticket_addon_variants(id uuid PRIMARY KEY,addon_id uuid REFERENCES public.ticket_addons(id),price_cents int,
 quantity_total int,quantity_sold int DEFAULT 0,quantity_held int DEFAULT 0);
CREATE TABLE public.cart_line_items(id uuid PRIMARY KEY,cart_id uuid REFERENCES public.carts(id),category text,tier_id uuid REFERENCES public.ticket_types(id),
 addon_id uuid REFERENCES public.ticket_addons(id),variant_id uuid REFERENCES public.ticket_addon_variants(id),bound_line_item_id uuid REFERENCES public.cart_line_items(id),
 quantity int,unit_price_cents int,refunded_amount_cents int DEFAULT 0,metadata jsonb DEFAULT '{}');
CREATE TABLE public.cart_holds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cart_id uuid REFERENCES public.carts(id),line_item_id uuid REFERENCES public.cart_line_items(id),
 tier_id uuid REFERENCES public.ticket_types(id),addon_id uuid REFERENCES public.ticket_addons(id),variant_id uuid REFERENCES public.ticket_addon_variants(id),
 qty int,expires_at timestamptz,released boolean DEFAULT false,released_at timestamptz);
CREATE TABLE public.ticket_holds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,ticket_type_id uuid REFERENCES public.ticket_types(id),event_id int,
 quantity int,payment_intent_id text,status text,expires_at timestamptz,guest_email text,hold_kind text);
CREATE TABLE public.tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),cart_id uuid REFERENCES public.carts(id),
 stripe_payment_intent_id text,stripe_checkout_session_id text,ticket_type_id uuid REFERENCES public.ticket_types(id),event_id int,
 user_id text,guest_email text,status text,category text);
CREATE TABLE public.order_addons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id),cart_id uuid REFERENCES public.carts(id));
CREATE TABLE public.cart_line_refunds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),cart_id uuid REFERENCES public.carts(id));
-- Helpers only used by the locked-tier stock allocator in this flat-price fixture.
CREATE FUNCTION public.ticket_type_current_price_cents(uuid) RETURNS int LANGUAGE sql AS $$ SELECT price_cents FROM public.ticket_types WHERE id=$1 $$;
CREATE FUNCTION public.ticket_type_available(uuid) RETURNS int LANGUAGE sql AS $$ SELECT quantity_total-quantity_sold FROM public.ticket_types WHERE id=$1 $$;
CREATE FUNCTION public.addon_available(uuid) RETURNS int LANGUAGE sql AS $$ SELECT quantity_total-quantity_sold-quantity_held FROM public.ticket_addons WHERE id=$1 $$;
CREATE FUNCTION public.addon_variant_available(uuid) RETURNS int LANGUAGE sql AS $$ SELECT quantity_total-quantity_sold-quantity_held FROM public.ticket_addon_variants WHERE id=$1 $$;

ALTER TABLE orders ADD COLUMN updated_at timestamptz DEFAULT now(),ADD COLUMN refunded_at timestamptz,
 ADD COLUMN checkout_failure_reason text,ADD COLUMN checkout_failure_code text,ADD COLUMN last_event_at timestamptz;
ALTER TABLE tickets ADD COLUMN qr_token text,ADD COLUMN qr_payload text,ADD COLUMN purchase_amount_cents int,
 ADD COLUMN cart_line_item_id uuid,ADD COLUMN order_index int,ADD COLUMN order_count int,ADD COLUMN attendee_name text,
 ADD COLUMN guest_name text,ADD COLUMN guest_lookup_token text;
ALTER TABLE ticket_addons ADD COLUMN is_redeemable boolean DEFAULT false;
ALTER TABLE order_addons ADD COLUMN event_id int,ADD COLUMN addon_id uuid,ADD COLUMN variant_id uuid,ADD COLUMN ticket_id uuid,
 ADD COLUMN cart_line_item_id uuid,ADD COLUMN user_id text,ADD COLUMN guest_email text,ADD COLUMN quantity int,ADD COLUMN unit_price_cents int,
 ADD COLUMN status text,ADD COLUMN qr_token text,ADD COLUMN qr_payload text,ADD COLUMN refunded_amount_cents int DEFAULT 0;
ALTER TABLE orders ADD COLUMN sold_by_staff_user_id text;
