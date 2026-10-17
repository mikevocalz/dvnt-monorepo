-- Disposable PostgreSQL integration test. Do NOT run in production.
-- Requires a fresh throwaway database and psql -v ON_ERROR_STOP=1.
-- Supabase normally supplies service_role; standalone PostgreSQL does not.
-- Create this NOLOGIN role in the disposable runner cluster, never in live DB.
DO $
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   CREATE ROLE service_role NOLOGIN;
 END IF;
END;
$;
CREATE TABLE public.orders(
 id uuid PRIMARY KEY,
 status text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ticket_embed_checkout_attempts(
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.orders(id),
 state text NOT NULL CHECK(state IN ('pending','cancelled'))
);
\ir ../apps/mobile/supabase/migrations/20261017110000_checkout_failure_taxonomy.sql

INSERT INTO public.orders(id,status) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','payment_pending'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','payment_failed'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','payment_failed'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','paid');
UPDATE public.orders SET checkout_failure_reason='checkout_expired'
 WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
UPDATE public.orders SET checkout_failure_reason='payment_declined',
 checkout_failure_code='card_declined'
 WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

INSERT INTO public.ticket_embed_checkout_attempts(id,order_id,state) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','pending'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','pending');

DO $$
BEGIN
 IF NOT public.mark_embed_checkout_cancelled('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
   RAISE EXCEPTION 'pending order cancellation did not apply';
 END IF;
 IF public.mark_embed_checkout_cancelled('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN
   RAISE EXCEPTION 'repeat cancellation must be idempotent';
 END IF;
 IF NOT public.mark_embed_checkout_cancelled('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') THEN
   RAISE EXCEPTION 'explicit cancel must win an expired webhook race';
 END IF;
 IF public.mark_embed_checkout_cancelled('cccccccc-cccc-4ccc-8ccc-cccccccccccc') THEN
   RAISE EXCEPTION 'real processor decline must not be overwritten by cancellation';
 END IF;
 IF public.mark_embed_checkout_cancelled('dddddddd-dddd-4ddd-8ddd-dddddddddddd') THEN
   RAISE EXCEPTION 'paid order must never be downgraded';
 END IF;
 IF (SELECT count(*) FROM public.orders WHERE checkout_failure_reason='payment_cancelled')<>2
    OR (SELECT count(*) FROM public.ticket_embed_checkout_attempts WHERE state='cancelled')<>2 THEN
   RAISE EXCEPTION 'cancelled order and attempt state must be consistent';
 END IF;
END;
$$;

UPDATE public.orders SET status='paid'
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

DO $$
BEGIN
 IF EXISTS(
   SELECT 1 FROM public.orders WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND (checkout_failure_reason IS NOT NULL OR checkout_failure_code IS NOT NULL)
 ) THEN
   RAISE EXCEPTION 'paid recovery must clear old checkout diagnostics';
 END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.orders WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
     AND checkout_failure_reason='payment_declined' AND checkout_failure_code='card_declined'
 ) THEN
   RAISE EXCEPTION 'verified Stripe card decline was overwritten';
 END IF;
END;
$$;
SELECT 'checkout-failure-taxonomy PASS' AS result;
