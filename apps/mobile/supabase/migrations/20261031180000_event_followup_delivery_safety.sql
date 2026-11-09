-- No enrollments or sends: opt-in campaigns stay opt-in. Apply before worker deploy.
BEGIN;
ALTER TABLE public.event_followup_campaigns ADD COLUMN IF NOT EXISTS profile_cta_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_followup_outbox
 ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'attendee' CHECK (purpose IN ('attendee','preview')),
 ADD COLUMN IF NOT EXISTS lease_token uuid,
 ADD COLUMN IF NOT EXISTS lease_until timestamptz,
 ADD COLUMN IF NOT EXISTS first_attempt_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivery_deadline timestamptz,
 ADD COLUMN IF NOT EXISTS provider_payload jsonb,
 ADD COLUMN IF NOT EXISTS content_override jsonb;
-- Fail rather than deleting or guessing how to reconcile historical duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS event_followup_once_per_recipient
 ON public.event_followup_outbox(event_id, recipient_email, purpose);

CREATE OR REPLACE FUNCTION public.validate_event_followup_content(p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_content IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_content)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_content) k WHERE k NOT IN ('subject','message','cta_label','profile_cta_enabled'))
 OR (p_content ? 'subject' AND (jsonb_typeof(p_content->'subject')<>'string' OR length(p_content->>'subject')>120))
 OR (p_content ? 'message' AND (jsonb_typeof(p_content->'message')<>'string' OR length(p_content->>'message')>3000))
 OR (p_content ? 'cta_label' AND (jsonb_typeof(p_content->'cta_label')<>'string' OR length(p_content->>'cta_label')>60))
 OR (p_content ? 'profile_cta_enabled' AND jsonb_typeof(p_content->'profile_cta_enabled')<>'boolean')
 THEN RAISE EXCEPTION 'Invalid follow-up copy'; END IF;
 RETURN p_content;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_event_followup(p_event_id integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
 -- Serialize settings changes and enqueue for this event. Never auto-enroll.
 PERFORM 1 FROM public.event_followup_campaigns WHERE event_id=p_event_id
 AND enabled AND scheduled_at<=now() FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 INSERT INTO public.event_followup_outbox(event_id,campaign_version,recipient_email,recipient_user_id,ticket_id)
 SELECT DISTINCT ON (lower(trim(CASE WHEN coalesce(t.claimed_by,t.user_id) IS NOT NULL THEN u.email ELSE t.guest_email END)))
 c.event_id,c.campaign_version,lower(trim(CASE WHEN coalesce(t.claimed_by,t.user_id) IS NOT NULL THEN u.email ELSE t.guest_email END)),coalesce(t.claimed_by,t.user_id),t.id
 FROM public.event_followup_campaigns c JOIN public.events e ON e.id=c.event_id
 JOIN public.tickets t ON t.event_id=e.id
 JOIN public.ticket_types tt ON tt.id=t.ticket_type_id AND tt.event_id=t.event_id AND tt.category='admission'
 LEFT JOIN public.users profile ON profile.id::text=coalesce(t.claimed_by,t.user_id)
 LEFT JOIN public."user" u ON u.id=coalesce(profile.auth_id, t.claimed_by,t.user_id)
 WHERE c.event_id=p_event_id AND c.enabled AND c.scheduled_at<=now()
 AND coalesce(e.end_date,e.start_date+interval '3 hours')<=now()
 AND coalesce(e.status,'') NOT IN ('cancelled','canceled','deleted','postponed')
 AND t.status IN ('active','scanned')
 AND trim(CASE WHEN coalesce(t.claimed_by,t.user_id) IS NOT NULL THEN u.email ELSE t.guest_email END) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 ORDER BY lower(trim(CASE WHEN coalesce(t.claimed_by,t.user_id) IS NOT NULL THEN u.email ELSE t.guest_email END)),t.id
 ON CONFLICT (event_id,recipient_email,purpose) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.claim_event_followups(p_event_ids integer[] DEFAULT NULL,p_preview_id bigint DEFAULT NULL,p_limit integer DEFAULT 8)
RETURNS SETOF public.event_followup_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_preview_id IS NOT NULL AND (p_event_ids IS NULL OR cardinality(p_event_ids)<>1) THEN RAISE EXCEPTION 'Preview requires one event'; END IF;
 IF p_event_ids IS NOT NULL AND (cardinality(p_event_ids)<1 OR cardinality(p_event_ids)>10) THEN RAISE EXCEPTION 'Explicit scope must contain 1-10 events'; END IF;
 RETURN QUERY WITH candidates AS (
 SELECT o.id FROM public.event_followup_outbox o
 LEFT JOIN public.event_followup_campaigns c ON c.event_id=o.event_id
 WHERE o.purpose=CASE WHEN p_preview_id IS NOT NULL THEN 'preview' ELSE 'attendee' END
 AND (p_event_ids IS NULL OR o.event_id=ANY(p_event_ids))
 AND (p_preview_id IS NULL OR o.id=p_preview_id)
 AND (p_preview_id IS NOT NULL OR (c.enabled AND c.scheduled_at<=now()))
 AND (o.status IN ('pending','failed') OR (o.status='sending' AND o.lease_until<now()))
 AND (o.delivery_deadline IS NULL OR o.delivery_deadline>now())
 ORDER BY o.id FOR UPDATE OF o SKIP LOCKED LIMIT greatest(1,least(p_limit,8))
 ) UPDATE public.event_followup_outbox o SET status='sending',lease_token=gen_random_uuid(),
 lease_until=now()+interval '2 minutes',attempt_count=o.attempt_count+1,updated_at=now()
 FROM candidates x WHERE o.id=x.id RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION public.event_followup_recipient_eligible(p_event_id integer,p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tickets t
 JOIN public.ticket_types tt ON tt.id=t.ticket_type_id AND tt.event_id=t.event_id AND tt.category='admission'
 LEFT JOIN public.users p ON p.id::text=coalesce(t.claimed_by,t.user_id)
 LEFT JOIN public."user" a ON a.id=coalesce(p.auth_id,t.claimed_by,t.user_id)
 WHERE t.event_id=p_event_id AND t.status IN ('active','scanned')
 AND lower(trim(CASE WHEN coalesce(t.claimed_by,t.user_id) IS NULL THEN t.guest_email ELSE a.email END))=lower(trim(p_email)));
$$;

CREATE OR REPLACE FUNCTION public.event_followup_recipient_suppressed(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_followup_email_suppressions WHERE lower(trim(email))=lower(trim(p_email)))
 OR EXISTS(SELECT 1 FROM public."user" a JOIN public.users p ON p.auth_id=a.id
 JOIN public.brand_message_opt_outs o ON o.recipient_id=p.id WHERE lower(trim(a.email))=lower(trim(p_email)));
$$;

CREATE OR REPLACE FUNCTION public.prepare_event_followup(p_id bigint,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.event_followup_outbox;
BEGIN
 SELECT * INTO r FROM public.event_followup_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'sending' OR r.lease_token IS DISTINCT FROM p_lease OR r.lease_until<=now()
 OR (r.delivery_deadline IS NOT NULL AND r.delivery_deadline<=now()) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF public.event_followup_recipient_suppressed(r.recipient_email) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=r.event_id
 AND coalesce(e.end_date,e.start_date+interval '3 hours')<=now()
 AND coalesce(e.status,'') NOT IN ('cancelled','canceled','deleted','postponed')) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF r.purpose='attendee' AND (NOT public.event_followup_recipient_eligible(r.event_id,r.recipient_email)
 OR NOT EXISTS(SELECT 1 FROM public.event_followup_campaigns WHERE event_id=r.event_id AND enabled AND scheduled_at<=now()))
 THEN RETURN jsonb_build_object('ok',false); END IF;
 IF p_payload->>'to'  IS DISTINCT FROM r.recipient_email OR nullif(p_payload->>'html','') IS NULL
 OR nullif(p_payload->>'subject','') IS NULL OR nullif(p_payload->>'from','') IS NULL THEN RAISE EXCEPTION 'Invalid payload'; END IF;
 UPDATE public.event_followup_outbox SET provider_payload=coalesce(provider_payload,p_payload),
 first_attempt_at=coalesce(first_attempt_at,now()),delivery_deadline=coalesce(delivery_deadline,now()+interval '23 hours'),updated_at=now()
 WHERE id=p_id RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'payload',r.provider_payload,'delivery_deadline',r.delivery_deadline);
END $$;

CREATE OR REPLACE FUNCTION public.complete_event_followup(p_id bigint,p_lease uuid,p_outcome text,p_provider_message_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_outcome NOT IN ('sent','failed','suppressed') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 IF p_outcome='sent' AND nullif(trim(p_provider_message_id),'') IS NULL THEN RAISE EXCEPTION 'Provider receipt required'; END IF;
 UPDATE public.event_followup_outbox SET status=p_outcome,provider_message_id=coalesce(p_provider_message_id,provider_message_id),
 sent_at=CASE WHEN p_outcome='sent' THEN now() ELSE sent_at END,last_error=left(p_error,200),lease_until=NULL,updated_at=now()
 WHERE id=p_id AND status='sending' AND lease_token=p_lease;
 RETURN FOUND;
END $$;

-- One preview per event/address, isolated from attendee delivery history. No campaign needed.
CREATE OR REPLACE FUNCTION public.enqueue_event_followup_preview(p_event_id integer,p_email text,p_content jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result bigint; email text:=lower(trim(p_email));
BEGIN
 p_content:=public.validate_event_followup_content(p_content);
 IF email IS NULL OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Valid preview address required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND coalesce(end_date,start_date+interval '3 hours')<=now()
 AND coalesce(status,'') NOT IN ('cancelled','canceled','deleted','postponed')) THEN RAISE EXCEPTION 'Completed event required'; END IF;
 INSERT INTO public.event_followup_outbox(event_id,campaign_version,recipient_email,purpose,content_override)
 VALUES(p_event_id,0,email,'preview',p_content) ON CONFLICT(event_id,recipient_email,purpose) DO NOTHING;
 SELECT id INTO result FROM public.event_followup_outbox WHERE event_id=p_event_id AND recipient_email=email AND purpose='preview';
 RETURN result;
END $$;

-- Explicit one-shot catch-up only. Never run automatically or across all history.
CREATE OR REPLACE FUNCTION public.enable_event_followup_catchup(p_event_ids integer[],p_content jsonb DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
 p_content:=public.validate_event_followup_content(p_content);
 IF p_event_ids IS NULL OR cardinality(p_event_ids)<1 OR cardinality(p_event_ids)>10 OR
 EXISTS(SELECT 1 FROM unnest(p_event_ids) x LEFT JOIN public.events e ON e.id=x WHERE e.id IS NULL
 OR coalesce(e.end_date,e.start_date+interval '3 hours')>now() OR coalesce(e.end_date,e.start_date+interval '3 hours') IS NULL
 OR coalesce(e.status,'') IN ('cancelled','canceled','deleted','postponed')) THEN RAISE EXCEPTION 'Explicit completed events required'; END IF;
 -- Existing disabled campaigns represent an organizer choice: never override it.
 IF EXISTS(SELECT 1 FROM public.event_followup_campaigns WHERE event_id=ANY(p_event_ids) AND NOT enabled) THEN RAISE EXCEPTION 'Organizer disabled campaign'; END IF;
 INSERT INTO public.event_followup_campaigns(event_id,enabled,scheduled_at,status,subject,message,cta_label,profile_cta_enabled)
 SELECT DISTINCT x,true,now(),'scheduled',p_content->>'subject',coalesce(p_content->>'message',''),coalesce(p_content->>'cta_label','Leave a review'),coalesce((p_content->>'profile_cta_enabled')::boolean,false) FROM unnest(p_event_ids) x
 ON CONFLICT(event_id) DO UPDATE SET scheduled_at=least(public.event_followup_campaigns.scheduled_at,now()),status='scheduled',updated_at=now(),
 subject=coalesce(p_content->>'subject',public.event_followup_campaigns.subject),message=coalesce(p_content->>'message',public.event_followup_campaigns.message),
 cta_label=coalesce(p_content->>'cta_label',public.event_followup_campaigns.cta_label),profile_cta_enabled=coalesce((p_content->>'profile_cta_enabled')::boolean,public.event_followup_campaigns.profile_cta_enabled)
 WHERE public.event_followup_campaigns.enabled AND public.event_followup_campaigns.status<>'sent';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_event_followup_status(p_event_ids integer[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_event_ids IS NULL OR cardinality(p_event_ids)>25 THEN RAISE EXCEPTION 'Bounded event scope required'; END IF;
 UPDATE public.event_followup_campaigns c SET audience_count=a.total,sent_count=a.sent,failed_count=a.failed,
 status=CASE WHEN NOT c.enabled THEN 'disabled' WHEN a.failed>0 THEN 'partial_failure' WHEN a.pending>0 THEN 'scheduled' ELSE 'sent' END,updated_at=now()
 FROM (SELECT e.event_id,count(o.id)::integer total,
 count(o.id) FILTER(WHERE o.status='sent')::integer sent,
 count(o.id) FILTER(WHERE o.status='failed' OR (o.status='sending' AND o.delivery_deadline<=now()))::integer failed,
 count(o.id) FILTER(WHERE o.status IN ('pending','sending') AND (o.delivery_deadline IS NULL OR o.delivery_deadline>now()))::integer pending
 FROM unnest(p_event_ids) e(event_id) LEFT JOIN public.event_followup_outbox o ON o.event_id=e.event_id AND o.purpose='attendee'
 GROUP BY e.event_id) a WHERE c.event_id=a.event_id;
END $$;

-- Server-side dispatch uses the existing secret without exposing it to callers.
CREATE OR REPLACE FUNCTION public.dispatch_event_followups(p_event_ids integer[],p_preview_email text DEFAULT NULL,p_content jsonb DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret text; body jsonb;
BEGIN
 p_content:=public.validate_event_followup_content(p_content);
 IF p_content IS NOT NULL AND p_preview_email IS NULL THEN RAISE EXCEPTION 'Content is only accepted for explicit preview'; END IF;
 IF p_event_ids IS NULL OR cardinality(p_event_ids)<1 OR cardinality(p_event_ids)>10 OR
 (p_preview_email IS NOT NULL AND cardinality(p_event_ids)<>1) THEN RAISE EXCEPTION 'Explicit event scope required'; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1;
 IF nullif(secret,'') IS NULL THEN RAISE EXCEPTION 'Worker authorization unavailable'; END IF;
 body:=jsonb_build_object('event_ids',p_event_ids);
 IF p_preview_email IS NOT NULL THEN body:=body||jsonb_build_object('preview_email',p_preview_email); END IF;
 IF p_content IS NOT NULL THEN body:=body||jsonb_build_object('preview_content',p_content); END IF;
 RETURN net.http_post(url:='https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/process-event-followups',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),body:=body,timeout_milliseconds:=120000);
END $$;

REVOKE ALL ON FUNCTION public.validate_event_followup_content(jsonb),public.refresh_event_followup_status(integer[]),public.event_followup_recipient_eligible(integer,text),public.event_followup_recipient_suppressed(text),public.enqueue_event_followup(integer), public.claim_event_followups(integer[],bigint,integer),
 public.prepare_event_followup(bigint,uuid,jsonb),public.complete_event_followup(bigint,uuid,text,text,text),
 public.enqueue_event_followup_preview(integer,text,jsonb),public.enable_event_followup_catchup(integer[],jsonb),
 public.dispatch_event_followups(integer[],text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_event_followup_content(jsonb),public.refresh_event_followup_status(integer[]),public.event_followup_recipient_eligible(integer,text),public.event_followup_recipient_suppressed(text),public.enqueue_event_followup(integer), public.claim_event_followups(integer[],bigint,integer),
 public.prepare_event_followup(bigint,uuid,jsonb),public.complete_event_followup(bigint,uuid,text,text,text),
 public.enqueue_event_followup_preview(integer,text,jsonb),public.enable_event_followup_catchup(integer[],jsonb),
 public.dispatch_event_followups(integer[],text,jsonb) TO service_role;
COMMIT;
