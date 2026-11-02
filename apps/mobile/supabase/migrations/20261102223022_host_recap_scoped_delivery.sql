-- Explicit host recaps only. No scheduler, enrollments, or source-table changes.
BEGIN;
CREATE TABLE public.host_recap_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_ids integer[] NOT NULL CHECK(cardinality(event_ids) BETWEEN 1 AND 10),
 host_auth_id text NOT NULL, period text NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 kind text NOT NULL CHECK(kind IN ('financial','generic')),
 recipient_email text NOT NULL, confirmed_email text,
 subject text NOT NULL, html text NOT NULL, approved_hash text NOT NULL CHECK(approved_hash ~ '^[0-9a-f]{64}$'),
 sender text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','unknown','held')),
 provider_message_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, completed_at timestamptz,
 UNIQUE(host_auth_id,period)
);
ALTER TABLE public.host_recap_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.host_recap_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.host_recap_deliveries TO service_role;

CREATE FUNCTION public.host_recap_eligible(p_events integer[],p_host text,p_email text,p_kind text,p_confirmed text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT cardinality(p_events) BETWEEN 1 AND 10
 AND NOT EXISTS(SELECT 1 FROM unnest(p_events) scoped(event_id) LEFT JOIN public.events e ON e.id=scoped.event_id
 WHERE e.id IS NULL OR e.host_id IS DISTINCT FROM p_host OR e.end_date IS NULL OR e.start_date IS NULL
 OR e.end_date>now() OR e.start_date>=e.end_date OR coalesce(e.status,'')<>'active' OR e.cancelled_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM public."user" a WHERE a.id=p_host AND lower(trim(a.email))=p_email
 AND (a."emailVerified" IS TRUE OR (p_kind='financial' AND p_confirmed=p_email)))
 AND EXISTS(SELECT 1 FROM public.users p WHERE p.auth_id=p_host AND lower(trim(p.email))=p_email AND p.banned_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.event_followup_email_suppressions s WHERE lower(trim(s.email))=p_email)
 AND NOT EXISTS(SELECT 1 FROM public.users p JOIN public.brand_message_opt_outs o ON o.recipient_id=p.id WHERE p.auth_id=p_host)
 AND (p_kind='financial' OR (p_kind='generic' AND NOT EXISTS(
 SELECT 1 FROM public.orders o WHERE o.event_id=ANY(p_events) AND o.total_cents>0
 AND (o.paid_at IS NOT NULL OR o.status IN ('paid','partially_refunded','refunded')))
 AND NOT EXISTS(SELECT 1 FROM public.tickets t WHERE t.event_id=ANY(p_events) AND t.purchase_amount_cents>0)));
$$;

CREATE FUNCTION public.enqueue_host_recap(p_event_ids integer[],p_period text,p_kind text,p_subject text,p_html text,p_approved_hash text,p_confirmed_email text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids integer[]; host text; email text; confirmed text:=lower(trim(p_confirmed_email)); existing public.host_recap_deliveries; result uuid;
BEGIN
 IF p_event_ids IS NULL OR cardinality(p_event_ids) NOT BETWEEN 1 AND 10 OR EXISTS(SELECT 1 FROM unnest(p_event_ids) x WHERE x IS NULL OR x<=0)
 OR (SELECT count(DISTINCT x) FROM unnest(p_event_ids) x)<>cardinality(p_event_ids) THEN RAISE EXCEPTION 'Explicit distinct event scope required'; END IF;
 SELECT array_agg(x ORDER BY x) INTO ids FROM unnest(p_event_ids) x;
 IF p_period IS NULL OR p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR p_kind IS NULL OR p_kind NOT IN ('financial','generic')
 OR p_subject IS NULL OR length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR p_subject ~ '[\r\n]'
 OR p_html IS NULL OR length(p_html) NOT BETWEEN 1 AND 200000
 OR p_approved_hash IS DISTINCT FROM encode(sha256(convert_to(p_subject||chr(10)||p_html,'UTF8')),'hex')
 OR (p_kind='generic' AND confirmed IS NOT NULL) THEN RAISE EXCEPTION 'Invalid approved recap'; END IF;
 SELECT e.host_id,lower(trim(a.email)) INTO host,email FROM public.events e JOIN public."user" a ON a.id=e.host_id WHERE e.id=ids[1];
 IF email IS NULL OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR (confirmed IS NOT NULL AND confirmed<>email)
 OR NOT coalesce(public.host_recap_eligible(ids,host,email,p_kind,confirmed),false) THEN RAISE EXCEPTION 'Host recap ineligible'; END IF;
 INSERT INTO public.host_recap_deliveries(event_ids,host_auth_id,period,kind,recipient_email,confirmed_email,subject,html,approved_hash)
 VALUES(ids,host,p_period,p_kind,email,confirmed,p_subject,p_html,p_approved_hash) ON CONFLICT(host_auth_id,period) DO NOTHING RETURNING id INTO result;
 IF result IS NULL THEN
 SELECT * INTO existing FROM public.host_recap_deliveries WHERE host_auth_id=host AND period=p_period;
 IF existing.event_ids IS DISTINCT FROM ids OR existing.kind IS DISTINCT FROM p_kind OR existing.recipient_email IS DISTINCT FROM email
 OR existing.approved_hash IS DISTINCT FROM p_approved_hash OR existing.confirmed_email IS DISTINCT FROM confirmed THEN RAISE EXCEPTION 'Host period recap conflict'; END IF;
 result:=existing.id;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.claim_host_recap(p_id uuid,p_hash text,p_sender text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.host_recap_deliveries;
BEGIN
 SELECT * INTO r FROM public.host_recap_deliveries WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.approved_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Recap or approved hash mismatch'; END IF;
 IF r.status<>'pending' THEN RETURN jsonb_build_object('status',r.status,'provider_message_id',r.provider_message_id); END IF;
 IF p_sender IS NULL OR length(trim(p_sender))=0 OR p_sender ~ '[\r\n]' THEN RAISE EXCEPTION 'Sender required'; END IF;
 IF NOT coalesce(public.host_recap_eligible(r.event_ids,r.host_auth_id,r.recipient_email,r.kind,r.confirmed_email),false)
 OR r.approved_hash IS DISTINCT FROM encode(sha256(convert_to(r.subject||chr(10)||r.html,'UTF8')),'hex') THEN
 UPDATE public.host_recap_deliveries SET status='held',error='source_or_approval_changed',completed_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('status','held'); END IF;
 UPDATE public.host_recap_deliveries SET status='sending',sender=p_sender,claimed_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('status','claimed','id',r.id,'to',r.recipient_email,'from',p_sender,'subject',r.subject,'html',r.html,'approved_hash',r.approved_hash);
END $$;

CREATE FUNCTION public.complete_host_recap(p_id uuid,p_provider_id text,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.host_recap_deliveries SET status=CASE WHEN nullif(trim(p_provider_id),'') IS NOT NULL THEN 'accepted' ELSE 'unknown' END,
 provider_message_id=nullif(trim(p_provider_id),''),error=left(p_error,500),completed_at=now() WHERE id=p_id AND status='sending';
 RETURN FOUND;
END $$;

CREATE FUNCTION public.dispatch_host_recap(p_id uuid,p_hash text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.host_recap_deliveries WHERE id=p_id AND approved_hash=p_hash AND status='pending') THEN RAISE EXCEPTION 'Pending approved recap required'; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET' LIMIT 1;
 IF nullif(secret,'') IS NULL THEN RAISE EXCEPTION 'Worker authorization unavailable'; END IF;
 RETURN net.http_post(url:='https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/host-recap-email',headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),body:=jsonb_build_object('delivery_id',p_id,'approved_hash',p_hash),timeout_milliseconds:=120000);
END $$;
REVOKE ALL ON FUNCTION public.host_recap_eligible(integer[],text,text,text,text),public.enqueue_host_recap(integer[],text,text,text,text,text,text),public.claim_host_recap(uuid,text,text),public.complete_host_recap(uuid,text,text),public.dispatch_host_recap(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.host_recap_eligible(integer[],text,text,text,text),public.enqueue_host_recap(integer[],text,text,text,text,text,text),public.claim_host_recap(uuid,text,text),public.complete_host_recap(uuid,text,text),public.dispatch_host_recap(uuid,text) TO service_role;
COMMIT;
