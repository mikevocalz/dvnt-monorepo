-- Operator-only delivery ledger. No enqueue, scheduler, or backfill.
BEGIN;
CREATE TABLE public.host_payout_setup_email_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 host_id text NOT NULL UNIQUE,
 event_id integer NOT NULL,
 state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending','accepted')),
 provider_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 accepted_at timestamptz,
 CHECK ((state='accepted') = (provider_id IS NOT NULL AND accepted_at IS NOT NULL))
);
ALTER TABLE public.host_payout_setup_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_payout_setup_email_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.host_payout_setup_email_deliveries TO service_role;

CREATE FUNCTION public.host_payout_setup_candidate(p_event_id integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT jsonb_build_object('hostId', e.host_id, 'email', btrim(u.email), 'accountId', o.stripe_account_id)
 FROM public.events e
 JOIN public."user" u ON u.id=e.host_id
 LEFT JOIN public.organizer_accounts o ON o.host_id=e.host_id
 WHERE e.id=p_event_id AND e.status='active' AND e.visibility='public' AND NOT e.is_hidden
 AND (e.publish_at IS NULL OR e.publish_at<=now()) AND e.start_date>now()
 AND u."emailVerified" IS TRUE AND u.banned IS NOT TRUE AND nullif(btrim(u.email),'') IS NOT NULL
 AND EXISTS (SELECT 1 FROM public.ticket_types t WHERE t.event_id=e.id AND t.is_active IS TRUE
    AND t.price_cents>0 AND (t.sale_end IS NULL OR t.sale_end>now()))
 AND NOT EXISTS (SELECT 1 FROM public.host_payout_setup_email_deliveries d WHERE d.host_id=e.host_id)
 AND NOT EXISTS (SELECT 1 FROM public.users p JOIN public.brand_message_opt_outs x ON x.recipient_id=p.id WHERE p.auth_id=e.host_id)
$$;

CREATE FUNCTION public.claim_host_payout_setup_email(p_event_id integer,p_host_id text,p_email text,p_account text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 INSERT INTO public.host_payout_setup_email_deliveries(host_id,event_id)
 SELECT p_host_id,p_event_id
 WHERE public.host_payout_setup_candidate(p_event_id) =
       jsonb_build_object('hostId',p_host_id,'email',p_email,'accountId',p_account)
 ON CONFLICT (host_id) DO NOTHING RETURNING id
$$;

CREATE FUNCTION public.record_host_payout_setup_email(p_id uuid,p_provider_id text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH recorded AS (
   UPDATE public.host_payout_setup_email_deliveries
   SET state='accepted',provider_id=p_provider_id,accepted_at=now()
   WHERE id=p_id AND state='sending' AND length(btrim(p_provider_id)) BETWEEN 1 AND 120
   RETURNING id
 ) SELECT EXISTS(SELECT 1 FROM recorded)
$$;

REVOKE ALL ON FUNCTION public.host_payout_setup_candidate(integer),
 public.claim_host_payout_setup_email(integer,text,text,text),
 public.record_host_payout_setup_email(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.host_payout_setup_candidate(integer),
 public.claim_host_payout_setup_email(integer,text,text,text),
 public.record_host_payout_setup_email(uuid,text) TO service_role;
COMMIT;
