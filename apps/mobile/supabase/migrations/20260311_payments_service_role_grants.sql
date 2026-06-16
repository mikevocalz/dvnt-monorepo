-- Grant service_role full access to payments tables (edge functions use service_role)
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.order_timeline TO service_role;
GRANT ALL ON public.refund_requests TO service_role;
GRANT ALL ON public.organizer_branding TO service_role;
GRANT ALL ON public.stripe_customers TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
