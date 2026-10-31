-- Future window discovery only. No mail, historical enqueue, marker reset, or cron change.
BEGIN;
CREATE TABLE public.event_reminder_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer NOT NULL REFERENCES public.events(id),
 recipient_auth_id text,guest_email text,ticket_ids uuid[] NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','failed','suppressed')),
 attempts integer NOT NULL DEFAULT 0,lease_token uuid,leased_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),first_attempt_at timestamptz,delivery_deadline timestamptz,
 provider_payload jsonb,provider_message_id text,last_error text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((recipient_auth_id IS NULL)<>(guest_email IS NULL)),CHECK(cardinality(ticket_ids) BETWEEN 1 AND 100)
);
ALTER TABLE public.event_reminder_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_reminder_deliveries FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.event_reminder_deliveries TO service_role;
ALTER TABLE public.tickets ADD COLUMN reminder_delivery_id uuid REFERENCES public.event_reminder_deliveries(id);
CREATE INDEX event_reminder_ready ON public.event_reminder_deliveries(available_at,created_at) WHERE state IN ('queued','sending');
CREATE INDEX ticket_reminder_unassigned ON public.tickets(event_id,id) WHERE reminder_sent_at IS NULL AND reminder_delivery_id IS NULL;

CREATE FUNCTION public.reserve_event_reminders(p_event_id integer,p_limit integer DEFAULT 100)
RETURNS SETOF public.event_reminder_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b record;r event_reminder_deliveries%ROWTYPE;v_ids uuid[];
BEGIN
 -- Serialize discovery only; network sends never hold database locks.
 PERFORM pg_advisory_xact_lock(hashtext('event-reminder'),p_event_id);
 PERFORM 1 FROM events WHERE id=p_event_id AND start_date>=clock_timestamp()+interval '150 minutes'
 AND start_date<clock_timestamp()+interval '210 minutes' AND coalesce(status,'') NOT IN ('cancelled','canceled','deleted') FOR SHARE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
 SELECT t.id FROM tickets t WHERE t.event_id=p_event_id AND t.status IN ('active','scanned')
 AND t.reminder_sent_at IS NULL AND t.reminder_delivery_id IS NULL
 AND CASE WHEN t.user_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public."user" u WHERE u.id=t.user_id AND u."emailVerified"=true AND nullif(btrim(u.email),'') IS NOT NULL)
 ELSE nullif(btrim(t.guest_email),'') IS NOT NULL AND nullif(t.guest_lookup_token,'') IS NOT NULL END
 ORDER BY t.id LIMIT greatest(1,least(coalesce(p_limit,100),100)) FOR UPDATE OF t SKIP LOCKED
 ) selected;
 IF v_ids IS NULL THEN RETURN; END IF;
 FOR b IN SELECT t.user_id,CASE WHEN t.user_id IS NULL THEN lower(t.guest_email) ELSE NULL END email,array_agg(t.id ORDER BY t.id) ids
 FROM tickets t WHERE t.id=ANY(v_ids) GROUP BY t.user_id,CASE WHEN t.user_id IS NULL THEN lower(t.guest_email) ELSE NULL END LOOP
 INSERT INTO event_reminder_deliveries(event_id,recipient_auth_id,guest_email,ticket_ids)
 VALUES(p_event_id,b.user_id,b.email,b.ids) RETURNING * INTO r;
 UPDATE tickets SET reminder_delivery_id=r.id WHERE id=ANY(b.ids);
 RETURN NEXT r;
 END LOOP;
END $$;

CREATE FUNCTION public.claim_event_reminders(p_limit integer DEFAULT 25,p_delivery_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.event_reminder_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Expired rows must never hide eligible deliveries behind a LIMIT page.
 WITH expired AS (
 SELECT d.id FROM event_reminder_deliveries d JOIN events e ON e.id=d.event_id
 WHERE d.state IN ('queued','sending') AND (d.state='queued' OR d.leased_until<=clock_timestamp())
 AND (p_delivery_ids IS NULL OR d.id=ANY(p_delivery_ids))
 AND (d.attempts>=8 OR e.start_date IS NULL OR e.start_date<clock_timestamp()+interval '150 minutes'
 OR e.start_date>=clock_timestamp()+interval '210 minutes' OR coalesce(e.status,'') IN ('cancelled','canceled','deleted')
 OR d.delivery_deadline<clock_timestamp())
 ORDER BY d.created_at,d.id LIMIT 100 FOR UPDATE OF d SKIP LOCKED
 ) UPDATE event_reminder_deliveries d SET state='suppressed',last_error='reminder_window_or_attempts_exhausted',lease_token=NULL,leased_until=NULL
 FROM expired x WHERE d.id=x.id;
 RETURN QUERY WITH candidates AS (
 SELECT d.id,e.start_date FROM event_reminder_deliveries d JOIN events e ON e.id=d.event_id
 WHERE d.state IN ('queued','sending') AND d.available_at<=clock_timestamp()
 AND (d.state='queued' OR d.leased_until<=clock_timestamp()) AND d.attempts<8
 AND e.start_date>=clock_timestamp()+interval '150 minutes' AND e.start_date<clock_timestamp()+interval '210 minutes'
 AND coalesce(e.status,'') NOT IN ('cancelled','canceled','deleted')
 AND (d.delivery_deadline IS NULL OR d.delivery_deadline>=clock_timestamp())
 AND (p_delivery_ids IS NULL OR d.id=ANY(p_delivery_ids))
 ORDER BY d.available_at,d.created_at,d.id LIMIT greatest(1,least(coalesce(p_limit,25),100))
 FOR UPDATE OF d SKIP LOCKED
 ), changed AS (
 UPDATE event_reminder_deliveries d SET state='sending',attempts=d.attempts+1,
 lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes',
 first_attempt_at=coalesce(d.first_attempt_at,clock_timestamp()),
 delivery_deadline=least(coalesce(d.delivery_deadline,clock_timestamp()+interval '23 hours'),c.start_date-interval '150 minutes')
 FROM candidates c WHERE d.id=c.id RETURNING d.*
 ) SELECT * FROM changed;
END $$;

CREATE FUNCTION public.prepare_event_reminder(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r event_reminder_deliveries%ROWTYPE;v_email text;v_ids uuid[];v_tokens text[];v_payload jsonb;
BEGIN
 SELECT * INTO r FROM event_reminder_deliveries WHERE id=p_id AND lease_token=p_lease AND state='sending'
 AND leased_until>clock_timestamp() AND delivery_deadline>=clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 PERFORM 1 FROM events WHERE id=r.event_id AND start_date>=clock_timestamp()+interval '150 minutes'
 AND start_date<clock_timestamp()+interval '210 minutes' AND coalesce(status,'') NOT IN ('cancelled','canceled','deleted');
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 -- Revalidate every ticket, even when replaying an already-frozen provider body.
 IF EXISTS(SELECT 1 FROM unnest(r.ticket_ids) x LEFT JOIN tickets t ON t.id=x
 WHERE t.id IS NULL OR t.event_id IS DISTINCT FROM r.event_id OR t.reminder_delivery_id IS DISTINCT FROM r.id
 OR t.reminder_sent_at IS NOT NULL OR t.status NOT IN ('active','scanned')
 OR CASE WHEN r.recipient_auth_id IS NOT NULL THEN t.user_id IS DISTINCT FROM r.recipient_auth_id
 ELSE t.user_id IS NOT NULL OR lower(t.guest_email) IS DISTINCT FROM r.guest_email
 OR nullif(t.guest_lookup_token,'') IS NULL OR t.guest_lookup_expires_at<=clock_timestamp() END)
 THEN RETURN jsonb_build_object('ok',false); END IF;
 IF r.recipient_auth_id IS NOT NULL THEN
 SELECT email INTO v_email FROM public."user" WHERE id=r.recipient_auth_id AND "emailVerified"=true;
 ELSE v_email:=r.guest_email; END IF;
 v_payload:=coalesce(r.provider_payload,p_payload);
 IF v_email IS NULL OR v_payload->>'to' IS DISTINCT FROM v_email
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['to','from','subject','html']) k WHERE jsonb_typeof(v_payload->k) IS DISTINCT FROM 'string' OR length(btrim(v_payload->>k))=0)
 OR jsonb_typeof(v_payload->'ticket_ids') IS DISTINCT FROM 'array'
 THEN RETURN jsonb_build_object('ok',false); END IF;
 SELECT array_agg(x::uuid ORDER BY x::uuid) INTO v_ids FROM jsonb_array_elements_text(v_payload->'ticket_ids') x;
 IF v_ids IS DISTINCT FROM r.ticket_ids THEN RETURN jsonb_build_object('ok',false); END IF;
 IF r.recipient_auth_id IS NULL THEN
 -- Payload tokens correspond to payload ticket ordering, not an unrelated query order.
 SELECT array_agg(t.guest_lookup_token ORDER BY j.n) INTO v_tokens
 FROM jsonb_array_elements_text(v_payload->'ticket_ids') WITH ORDINALITY j(id,n) JOIN tickets t ON t.id=j.id::uuid;
 IF v_payload->'guest_lookup_tokens' IS DISTINCT FROM to_jsonb(v_tokens) THEN RETURN jsonb_build_object('ok',false); END IF;
 END IF;
 UPDATE event_reminder_deliveries SET provider_payload=v_payload WHERE id=r.id AND provider_payload IS NULL;
 RETURN jsonb_build_object('ok',true,'payload',v_payload);
END $$;

CREATE FUNCTION public.complete_event_reminder(p_id uuid,p_lease uuid,p_outcome text,p_provider_message_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r event_reminder_deliveries%ROWTYPE;
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('sent','retry','failed','suppressed') THEN RETURN false; END IF;
 SELECT * INTO r FROM event_reminder_deliveries WHERE id=p_id AND lease_token=p_lease AND state='sending'
 AND leased_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR (p_outcome='sent' AND (r.provider_payload IS NULL OR coalesce(length(btrim(p_provider_message_id)),0)=0)) THEN RETURN false; END IF;
 UPDATE event_reminder_deliveries SET state=CASE WHEN p_outcome='retry' AND attempts<8 AND delivery_deadline>=clock_timestamp() THEN 'queued'
 WHEN p_outcome='retry' THEN 'failed' ELSE p_outcome END,
 available_at=clock_timestamp()+make_interval(secs=>least(900,30*(2^attempts)::integer)),
 provider_message_id=CASE WHEN p_outcome='sent' THEN p_provider_message_id ELSE provider_message_id END,
 last_error=left(p_error,250),lease_token=NULL,leased_until=NULL WHERE id=r.id;
 IF p_outcome='sent' THEN
 -- Provider acceptance is durable even if ownership changed during the HTTP call.
 -- Never stamp the replacement owner's ticket as reminded by the prior email.
 UPDATE tickets t SET reminder_sent_at=clock_timestamp() WHERE t.id=ANY(r.ticket_ids) AND t.reminder_delivery_id=r.id
 AND t.reminder_sent_at IS NULL AND t.status IN ('active','scanned')
 AND CASE WHEN r.recipient_auth_id IS NOT NULL THEN t.user_id=r.recipient_auth_id
 ELSE t.user_id IS NULL AND lower(t.guest_email)=r.guest_email END;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.reserve_event_reminders(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_event_reminders(integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_event_reminders(integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_reminders(integer,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_event_reminder(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_event_reminder(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.complete_event_reminder(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_event_reminder(uuid,uuid,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
