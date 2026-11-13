CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.events(id int PRIMARY KEY,host_id text,payout_release_at timestamptz,payout_status text,end_date timestamptz,status text,start_date timestamptz);
CREATE TABLE public.carts(id uuid PRIMARY KEY);
CREATE TABLE public.organizer_accounts(host_id text PRIMARY KEY,stripe_account_id text);
CREATE TABLE public.event_promoters(id uuid PRIMARY KEY,event_id int,user_id text,stripe_account_id text,code text,status text,
 rev_share_bps int,customer_discount_bps int,promoter_commission_bps int);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,guest_email text,guest_phone text,
 type text,status text,event_id int,quantity int,currency text,subtotal_cents int,total_cents int,tax_cents int DEFAULT 0,
 platform_fee_cents int,buyer_pct_fee_cents int,buyer_per_ticket_fee_cents int,buyer_fee_cents int,org_pct_fee_cents int,
 org_per_ticket_fee_cents int,organizer_fee_cents int,dvnt_total_fee_cents int,fee_policy_version text,cart_id uuid UNIQUE,promo_code_id uuid,
 discount_cents int,promoter_id uuid,promoter_code text,promoter_policy_version text,promoter_original_amount_cents int,
 promoter_customer_discount_bps int,promoter_discount_amount_cents int,promoter_discounted_amount_cents int,
 promoter_commission_bps int,promoter_commission_amount_cents int,stripe_payment_intent_id text,stripe_checkout_session_id text,paid_at timestamptz);
CREATE TABLE public.promoter_attributions(order_id uuid PRIMARY KEY,promoter_id uuid,locked_rev_share_bps int,
 locked_customer_discount_bps int,locked_promoter_commission_bps int,locked_promoter_discount_amount_cents int,locked_promoter_commission_amount_cents int);
INSERT INTO events VALUES(1,'fixture-host','2020-01-01','pending','2019-12-30','published','2019-12-29');
INSERT INTO organizer_accounts VALUES('fixture-host','acct_host');
INSERT INTO event_promoters VALUES('00000000-0000-4000-8000-000000000002',1,NULL,NULL,'FIXTURE','active',1000,0,1000);

ALTER TABLE events ADD CONSTRAINT events_payout_status_check CHECK(payout_status IN ('pending','on_hold','released','disabled'));
