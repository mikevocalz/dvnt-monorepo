-- Future-only transactional receipts. Original RPCs remain unchanged for safe rollout.
-- Does not send mail, enqueue historical tickets, or schedule a worker.
BEGIN;
CREATE TABLE public.ticket_receipt_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_kind text NOT NULL CHECK(source_kind IN ('member_comp','guest_comp','phone_claim','transfer')),
 source_id text NOT NULL, event_id integer NOT NULL REFERENCES public.events(id),
 recipient_auth_id text, guest_email text, ticket_ids uuid[] NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','failed','suppressed')),
 attempts integer NOT NULL DEFAULT 0, lease_token uuid, leased_until timestamptz,
 first_attempt_at timestamptz, delivery_deadline timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(), provider_payload jsonb,
 provider_message_id text, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_kind,source_id),
 CHECK ((recipient_auth_id IS NULL) <> (guest_email IS NULL)),
 CHECK(cardinality(ticket_ids) BETWEEN 1 AND 100)
);
ALTER TABLE public.ticket_receipt_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_receipt_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ticket_receipt_outbox TO service_role;
CREATE INDEX ticket_receipt_ready ON public.ticket_receipt_outbox(available_at,created_at)
 WHERE state IN ('queued','sending');

CREATE FUNCTION public.enqueue_ticket_receipt(p_kind text,p_source text,p_event integer,p_recipient text,p_email text,p_tickets uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_ids uuid[];
BEGIN
 SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_tickets) x;
 IF cardinality(v_ids) IS NULL OR cardinality(v_ids) <> cardinality(p_tickets)
 OR EXISTS(SELECT 1 FROM unnest(v_ids) x LEFT JOIN tickets t ON t.id=x
 WHERE t.id IS NULL OR t.event_id IS DISTINCT FROM p_event OR t.status NOT IN ('active','scanned')
 OR CASE WHEN p_recipient IS NOT NULL THEN t.user_id IS DISTINCT FROM p_recipient
 ELSE t.user_id IS NOT NULL OR lower(t.guest_email) IS DISTINCT FROM lower(p_email) END)
 THEN RAISE EXCEPTION 'Invalid receipt bundle'; END IF;
 INSERT INTO ticket_receipt_outbox(source_kind,source_id,event_id,recipient_auth_id,guest_email,ticket_ids)
 VALUES(p_kind,p_source,p_event,p_recipient,lower(p_email),v_ids)
 ON CONFLICT(source_kind,source_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN
 SELECT id INTO v_id FROM ticket_receipt_outbox WHERE source_kind=p_kind AND source_id=p_source
 AND event_id=p_event AND recipient_auth_id IS NOT DISTINCT FROM p_recipient
 AND guest_email IS NOT DISTINCT FROM lower(p_email) AND ticket_ids=v_ids;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Receipt source conflict'; END IF;
 END IF;
 RETURN v_id;
END $$;

CREATE FUNCTION public.claim_ticket_receipts(p_limit integer DEFAULT 25,p_receipt_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.ticket_receipt_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Terminalize only bounded selected rows, never scan/update the whole queue.
 RETURN QUERY
 WITH candidates AS (
 SELECT id FROM ticket_receipt_outbox
 WHERE state IN ('queued','sending') AND available_at<=clock_timestamp()
 AND (state='queued' OR leased_until<=clock_timestamp())
 AND (p_receipt_ids IS NULL OR id=ANY(p_receipt_ids))
 ORDER BY available_at,created_at,id LIMIT greatest(1,least(coalesce(p_limit,25),100))
 FOR UPDATE SKIP LOCKED
 ), changed AS (
 UPDATE ticket_receipt_outbox o SET
 state=CASE WHEN attempts>=8 OR delivery_deadline<=clock_timestamp() THEN 'suppressed' ELSE 'sending' END,
 last_error=CASE WHEN attempts>=8 OR delivery_deadline<=clock_timestamp() THEN 'delivery_window_or_attempts_exhausted' ELSE last_error END,
 attempts=attempts+CASE WHEN attempts>=8 OR delivery_deadline<=clock_timestamp() THEN 0 ELSE 1 END,
 first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),
 delivery_deadline=coalesce(delivery_deadline,clock_timestamp()+interval '23 hours'),
 lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes'
 FROM candidates c WHERE o.id=c.id RETURNING o.*
 ) SELECT * FROM changed WHERE state='sending';
END $$;

CREATE FUNCTION public.prepare_ticket_receipt(p_id uuid,p_lease uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r ticket_receipt_outbox%ROWTYPE; v_email text; v_ids uuid[];
BEGIN
 SELECT * INTO r FROM ticket_receipt_outbox WHERE id=p_id AND lease_token=p_lease
 AND state='sending' AND leased_until>clock_timestamp() AND delivery_deadline>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false); END IF;
 IF r.provider_payload IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'payload',r.provider_payload); END IF;
 IF r.recipient_auth_id IS NOT NULL THEN
 SELECT email INTO v_email FROM public."user" WHERE id=r.recipient_auth_id AND "emailVerified"=true;
 ELSE v_email:=r.guest_email; END IF;
 IF v_email IS NULL OR p_payload->>'to' IS DISTINCT FROM v_email
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['to','from','subject','html']) k
 WHERE jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string' OR length(btrim(p_payload->>k))=0)
 OR jsonb_typeof(p_payload->'ticket_ids') IS DISTINCT FROM 'array'
 THEN RETURN jsonb_build_object('ok',false); END IF;
 SELECT array_agg(x::uuid ORDER BY x::uuid) INTO v_ids FROM jsonb_array_elements_text(p_payload->'ticket_ids') x;
 IF v_ids IS DISTINCT FROM r.ticket_ids THEN RETURN jsonb_build_object('ok',false); END IF;
 UPDATE ticket_receipt_outbox SET provider_payload=p_payload WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'payload',p_payload);
END $$;

CREATE FUNCTION public.complete_ticket_receipt(p_id uuid,p_lease uuid,p_outcome text,p_provider_message_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r ticket_receipt_outbox%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('sent','retry','failed','suppressed') OR p_outcome IS NULL THEN RETURN false; END IF;
 IF p_outcome='sent' AND coalesce(length(btrim(p_provider_message_id)),0)=0 THEN RETURN false; END IF;
 SELECT * INTO r FROM ticket_receipt_outbox WHERE id=p_id AND lease_token=p_lease
 AND state='sending' AND leased_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR (p_outcome='sent' AND r.provider_payload IS NULL) THEN RETURN false; END IF;
 UPDATE ticket_receipt_outbox SET state=CASE
 WHEN p_outcome='retry' AND attempts<8 AND delivery_deadline>clock_timestamp() THEN 'queued'
 WHEN p_outcome='retry' THEN 'failed' ELSE p_outcome END,
 available_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^attempts)::integer)),
 provider_message_id=CASE WHEN p_outcome='sent' THEN p_provider_message_id ELSE provider_message_id END,
 last_error=left(p_error,250),lease_token=NULL,leased_until=NULL WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.issue_comp_tickets_with_receipts(p_event_id integer,p_tier_id uuid,p_actor_id text,p_user_ids text[],p_quantity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; b record; v_ids uuid[] := '{}'::uuid[];
BEGIN
 r:=public.issue_comp_tickets_atomic(p_event_id,p_tier_id,p_actor_id,p_user_ids,p_quantity);
 IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r; END IF;
 FOR b IN SELECT t.order_id,t.user_id,t.guest_email,array_agg(t.id ORDER BY t.id) ids
 FROM tickets t JOIN jsonb_array_elements(r->'tickets') j ON t.id=(j->>'id')::uuid
 GROUP BY t.order_id,t.user_id,t.guest_email LOOP
 v_ids:=array_append(v_ids,public.enqueue_ticket_receipt('member_comp',b.order_id::text,p_event_id,
 b.user_id,NULL,b.ids));
 END LOOP;
 RETURN r || jsonb_build_object('receipt_ids',v_ids);
END $$;

CREATE FUNCTION public.issue_guest_comp_tickets_with_receipts(p_event_id integer,p_tier_id uuid,p_actor_id text,p_guest_emails text[],p_quantity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; b record; v_ids uuid[] := '{}'::uuid[];
BEGIN
 r:=public.issue_guest_comp_tickets_atomic(p_event_id,p_tier_id,p_actor_id,p_guest_emails,p_quantity);
 IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r; END IF;
 FOR b IN SELECT t.order_id,t.user_id,t.guest_email,array_agg(t.id ORDER BY t.id) ids
 FROM tickets t JOIN jsonb_array_elements(r->'tickets') j ON t.id=(j->>'id')::uuid
 GROUP BY t.order_id,t.user_id,t.guest_email LOOP
 v_ids:=array_append(v_ids,public.enqueue_ticket_receipt('guest_comp',b.order_id::text,p_event_id,
 NULL,b.guest_email,b.ids));
 END LOOP;
 RETURN r || jsonb_build_object('receipt_ids',v_ids);
END $$;

CREATE FUNCTION public.claim_comp_ticket_with_receipt(p_token text,p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; v_id uuid; v_ticket uuid;
BEGIN
 r:=public.claim_comp_ticket(p_token,p_user_id);
 IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r; END IF;
 v_ticket:=(r->>'ticket_id')::uuid;
 IF (r->>'already_claimed')::boolean IS FALSE THEN
 v_id:=public.enqueue_ticket_receipt('phone_claim',v_ticket::text,(r->>'event_id')::integer,p_user_id,NULL,ARRAY[v_ticket]);
 ELSE SELECT id INTO v_id FROM ticket_receipt_outbox WHERE source_kind='phone_claim'
 AND source_id=v_ticket::text AND recipient_auth_id=p_user_id; END IF;
 RETURN r || jsonb_build_object('receipt_ids',CASE WHEN v_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[v_id] END);
END $$;
CREATE FUNCTION public.accept_ticket_transfer_with_receipt(p_transfer_id uuid,p_recipient_id text,p_event_id integer,p_qr_token text,p_qr_payload text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; v_id uuid;
BEGIN
 r:=public.accept_ticket_transfer_atomic(p_transfer_id,p_recipient_id,p_event_id,p_qr_token,p_qr_payload);
 IF (r->>'ok')::boolean IS NOT TRUE THEN RETURN r; END IF;
 v_id:=public.enqueue_ticket_receipt('transfer',p_transfer_id::text,p_event_id,p_recipient_id,NULL,ARRAY[(r->>'ticket_id')::uuid]);
 RETURN r || jsonb_build_object('receipt_ids',ARRAY[v_id]);
END $$;
REVOKE ALL ON FUNCTION public.enqueue_ticket_receipt(text,text,integer,text,text,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ticket_receipt(text,text,integer,text,text,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.claim_ticket_receipts(integer,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ticket_receipts(integer,uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_ticket_receipt(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_ticket_receipt(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.complete_ticket_receipt(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ticket_receipt(uuid,uuid,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_comp_tickets_with_receipts(integer,uuid,text,text[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_comp_tickets_with_receipts(integer,uuid,text,text[],integer) TO service_role;
REVOKE ALL ON FUNCTION public.issue_guest_comp_tickets_with_receipts(integer,uuid,text,text[],integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_comp_tickets_with_receipts(integer,uuid,text,text[],integer) TO service_role;
REVOKE ALL ON FUNCTION public.claim_comp_ticket_with_receipt(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_comp_ticket_with_receipt(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.accept_ticket_transfer_with_receipt(uuid,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_ticket_transfer_with_receipt(uuid,text,integer,text,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
