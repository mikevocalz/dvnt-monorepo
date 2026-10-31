-- Classification and explicit preview revisions only; no enrollments or sends.
BEGIN;
ALTER TABLE public.event_followup_campaigns ADD COLUMN IF NOT EXISTS member_message text, ADD COLUMN IF NOT EXISTS guest_message text;
ALTER TABLE public.event_followup_outbox ADD COLUMN IF NOT EXISTS preview_revision integer NOT NULL DEFAULT 1
 CHECK (preview_revision BETWEEN 1 AND 100 AND (purpose='preview' OR preview_revision=1));
-- Legacy rows and frozen payloads remain revision 1, byte-for-byte unchanged.
-- Superseded campaign-version constraint would collide across preview revisions.
ALTER TABLE public.event_followup_outbox DROP CONSTRAINT event_followup_outbox_event_id_campaign_version_recipient_e_key;
DROP INDEX public.event_followup_once_per_recipient;
CREATE UNIQUE INDEX event_followup_once_per_recipient ON public.event_followup_outbox(event_id,recipient_email,purpose,preview_revision);
DROP FUNCTION public.enqueue_event_followup_preview(integer,text,jsonb);
DROP FUNCTION public.dispatch_event_followups(integer[],text,jsonb);
CREATE OR REPLACE FUNCTION public.validate_event_followup_content(p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF p_content IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(p_content)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_content) k WHERE k NOT IN ('subject','message','cta_label','profile_cta_enabled','member_message','guest_message'))
 OR (p_content ? 'subject' AND (jsonb_typeof(p_content->'subject')<>'string' OR length(p_content->>'subject')>120))
 OR (p_content ? 'message' AND (jsonb_typeof(p_content->'message')<>'string' OR length(p_content->>'message')>3000))
 OR (p_content ? 'cta_label' AND (jsonb_typeof(p_content->'cta_label')<>'string' OR length(p_content->>'cta_label')>60))
 OR (p_content ? 'profile_cta_enabled' AND jsonb_typeof(p_content->'profile_cta_enabled')<>'boolean')
 OR (p_content ? 'member_message' AND (jsonb_typeof(p_content->'member_message')<>'string' OR length(p_content->>'member_message')>3000))
 OR (p_content ? 'guest_message' AND (jsonb_typeof(p_content->'guest_message')<>'string' OR length(p_content->>'guest_message')>3000))
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
 ON CONFLICT (event_id,recipient_email,purpose,preview_revision) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.event_followup_recipient_is_member(p_event_id integer,p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 -- Classify actual accounts, not checkout origin or email-verification status.
 -- A current owner wins over a stale guest email after a transfer or claim.
 SELECT EXISTS(SELECT 1 FROM public."user" a WHERE lower(trim(a.email))=lower(trim(p_email)))
 OR EXISTS(SELECT 1 FROM public.tickets t
 JOIN public.ticket_types tt ON tt.id=t.ticket_type_id AND tt.event_id=t.event_id AND tt.category='admission'
 LEFT JOIN public.users p ON p.id::text=coalesce(t.claimed_by,t.user_id)
 JOIN public."user" a ON a.id=coalesce(p.auth_id,t.claimed_by,t.user_id)
 WHERE t.event_id=p_event_id AND t.status IN ('active','scanned')
 AND lower(trim(a.email))=lower(trim(p_email)));
$$;

CREATE OR REPLACE FUNCTION public.enqueue_event_followup_preview(p_event_id integer,p_email text,p_content jsonb DEFAULT NULL,p_revision integer DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result bigint; email text:=lower(trim(p_email));
BEGIN
 IF p_revision IS NULL OR p_revision NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid preview revision'; END IF;
 p_content:=public.validate_event_followup_content(p_content);
 IF email IS NULL OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Valid preview address required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND coalesce(end_date,start_date+interval '3 hours')<=now()
 AND coalesce(status,'') NOT IN ('cancelled','canceled','deleted','postponed')) THEN RAISE EXCEPTION 'Completed event required'; END IF;
 INSERT INTO public.event_followup_outbox(event_id,campaign_version,recipient_email,purpose,content_override,preview_revision)
 VALUES(p_event_id,0,email,'preview',p_content,p_revision) ON CONFLICT(event_id,recipient_email,purpose,preview_revision) DO NOTHING;
 SELECT id INTO result FROM public.event_followup_outbox WHERE event_id=p_event_id AND recipient_email=email AND purpose='preview' AND preview_revision=p_revision;
 RETURN result;
END $$;

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
 INSERT INTO public.event_followup_campaigns(event_id,enabled,scheduled_at,status,subject,message,cta_label,profile_cta_enabled,member_message,guest_message)
 SELECT DISTINCT x,true,now(),'scheduled',p_content->>'subject',coalesce(p_content->>'message',''),coalesce(p_content->>'cta_label','Leave a review'),coalesce((p_content->>'profile_cta_enabled')::boolean,false),p_content->>'member_message',p_content->>'guest_message' FROM unnest(p_event_ids) x
 ON CONFLICT(event_id) DO UPDATE SET scheduled_at=least(public.event_followup_campaigns.scheduled_at,now()),status='scheduled',updated_at=now(),
 subject=coalesce(p_content->>'subject',public.event_followup_campaigns.subject),message=coalesce(p_content->>'message',public.event_followup_campaigns.message),
 cta_label=coalesce(p_content->>'cta_label',public.event_followup_campaigns.cta_label),profile_cta_enabled=coalesce((p_content->>'profile_cta_enabled')::boolean,public.event_followup_campaigns.profile_cta_enabled),
 member_message=coalesce(p_content->>'member_message',public.event_followup_campaigns.member_message),guest_message=coalesce(p_content->>'guest_message',public.event_followup_campaigns.guest_message)
 WHERE public.event_followup_campaigns.enabled AND public.event_followup_campaigns.status<>'sent';
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.dispatch_event_followups(p_event_ids integer[],p_preview_email text DEFAULT NULL,p_content jsonb DEFAULT NULL,p_preview_revision integer DEFAULT 1)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret text; body jsonb;
BEGIN
 IF p_preview_revision IS NULL OR p_preview_revision NOT BETWEEN 1 AND 100 OR (p_preview_email IS NULL AND p_preview_revision<>1) THEN RAISE EXCEPTION 'Invalid preview revision'; END IF;
 p_content:=public.validate_event_followup_content(p_content);
 IF p_content IS NOT NULL AND p_preview_email IS NULL THEN RAISE EXCEPTION 'Content is only accepted for explicit preview'; END IF;
 IF p_event_ids IS NULL OR cardinality(p_event_ids)<1 OR cardinality(p_event_ids)>10 OR
 (p_preview_email IS NOT NULL AND cardinality(p_event_ids)<>1) THEN RAISE EXCEPTION 'Explicit event scope required'; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1;
 IF nullif(secret,'') IS NULL THEN RAISE EXCEPTION 'Worker authorization unavailable'; END IF;
 body:=jsonb_build_object('event_ids',p_event_ids);
 IF p_preview_email IS NOT NULL THEN body:=body||jsonb_build_object('preview_email',p_preview_email,'preview_revision',p_preview_revision); END IF;
 IF p_content IS NOT NULL THEN body:=body||jsonb_build_object('preview_content',p_content); END IF;
 RETURN net.http_post(url:='https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/process-event-followups',
 headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),body:=body,timeout_milliseconds:=120000);
END $$;
REVOKE ALL ON FUNCTION public.event_followup_recipient_is_member(integer,text),public.enqueue_event_followup_preview(integer,text,jsonb,integer),public.dispatch_event_followups(integer[],text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.event_followup_recipient_is_member(integer,text),public.enqueue_event_followup_preview(integer,text,jsonb,integer),public.dispatch_event_followups(integer[],text,jsonb,integer) TO service_role;
COMMIT;
