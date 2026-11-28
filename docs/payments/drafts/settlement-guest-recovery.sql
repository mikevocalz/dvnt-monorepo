-- Default-off identity recovery only. No replacement or provider dispatch authority.
BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN IF NOT EXISTS guest_checkout_recovery_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE dvnt_settlement.controls ADD COLUMN IF NOT EXISTS checkout_replacement_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE dvnt_settlement.guest_recovery_limits (
 scope text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts>0)
);
CREATE TABLE dvnt_settlement.guest_recovery_capabilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id),
 capability_hash text NOT NULL UNIQUE CHECK(capability_hash ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL DEFAULT 'replace_canceled_checkout' CHECK(purpose='replace_canceled_checkout'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 exchanged_at timestamptz
);
CREATE TABLE dvnt_settlement.guest_recovery_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES public.orders(id),
 capability_id uuid NOT NULL UNIQUE REFERENCES dvnt_settlement.guest_recovery_capabilities(id),
 session_hash text NOT NULL UNIQUE CHECK(session_hash ~ '^[a-f0-9]{64}$'),
 purpose text NOT NULL DEFAULT 'replace_canceled_checkout' CHECK(purpose='replace_canceled_checkout'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 consumed_at timestamptz
);
ALTER TABLE dvnt_settlement.guest_recovery_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.guest_recovery_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.guest_recovery_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.guest_recovery_limits,dvnt_settlement.guest_recovery_capabilities,dvnt_settlement.guest_recovery_sessions FROM PUBLIC,anon,authenticated,service_role;

-- One UPSERT is the rate-limit check and consumption: no check/record race.
-- Fixed one-hour windows anchored at first use, not caller-selected buckets.
CREATE FUNCTION dvnt_settlement.consume_guest_recovery_limit(p_scope text,p_max integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 INSERT INTO dvnt_settlement.guest_recovery_limits(scope,window_start,attempts) VALUES(p_scope,now(),1)
 ON CONFLICT(scope) DO UPDATE SET
  attempts=CASE WHEN guest_recovery_limits.window_start<=now()-interval '1 hour' THEN 1 ELSE guest_recovery_limits.attempts+1 END,
  window_start=CASE WHEN guest_recovery_limits.window_start<=now()-interval '1 hour' THEN now() ELSE guest_recovery_limits.window_start END
 WHERE guest_recovery_limits.window_start<=now()-interval '1 hour' OR guest_recovery_limits.attempts<p_max
 RETURNING attempts INTO n;
 RETURN n IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.consume_guest_recovery_limit(text,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.settlement_guest_recovery_issue(p_order_id uuid,p_email text,p_capability_hash text,p_email_hash text,p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; cap uuid; email_allowed boolean; ip_allowed boolean;
BEGIN
 IF NOT coalesce((SELECT guest_checkout_recovery_enabled AND checkout_replacement_enabled FROM dvnt_settlement.controls WHERE singleton),false) THEN RETURN jsonb_build_object('issued',false); END IF;
 IF p_capability_hash IS NULL OR p_capability_hash !~ '^[a-f0-9]{64}$' OR p_email_hash IS NULL OR p_email_hash !~ '^[a-f0-9]{64}$'
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[a-f0-9]{64}$' OR p_email IS NULL OR length(p_email)>254 THEN RETURN jsonb_build_object('issued',false); END IF;
 -- Canonical lock order for every issue: global, IP, then email. The global
 -- cap also bounds new limiter rows per hour despite spoofed forwarding headers.
 IF NOT dvnt_settlement.consume_guest_recovery_limit('issue:global',1000) THEN RETURN jsonb_build_object('issued',false); END IF;
 -- Never expose
 -- whether either limit or the exact stored identity matched to a client.
 ip_allowed:=dvnt_settlement.consume_guest_recovery_limit('issue:ip:'||p_ip_hash,10);
 email_allowed:=dvnt_settlement.consume_guest_recovery_limit('issue:email:'||p_email_hash,3);
 IF NOT ip_allowed OR NOT email_allowed THEN RETURN jsonb_build_object('issued',false); END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND OR o.user_id IS NOT NULL OR nullif(o.guest_email,'') IS NULL OR lower(o.guest_email) IS DISTINCT FROM lower(btrim(p_email))
 OR o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR o.status IS NULL
 OR o.status NOT IN ('created','payment_pending','payment_failed','failed','canceled','cancelled') OR o.paid_at IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id) THEN RETURN jsonb_build_object('issued',false); END IF;
 INSERT INTO dvnt_settlement.guest_recovery_capabilities(order_id,capability_hash) VALUES(o.id,p_capability_hash) RETURNING id INTO cap;
 RETURN jsonb_build_object('issued',true,'email',o.guest_email,'capability_id',cap);
END $$;
REVOKE ALL ON FUNCTION public.settlement_guest_recovery_issue(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settlement_guest_recovery_issue(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.settlement_guest_recovery_exchange(p_capability_hash text,p_session_hash text,p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cap dvnt_settlement.guest_recovery_capabilities%ROWTYPE; expires timestamptz;
BEGIN
 IF NOT coalesce((SELECT guest_checkout_recovery_enabled AND checkout_replacement_enabled FROM dvnt_settlement.controls WHERE singleton),false) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF p_capability_hash IS NULL OR p_capability_hash !~ '^[a-f0-9]{64}$' OR p_session_hash IS NULL OR p_session_hash !~ '^[a-f0-9]{64}$'
 OR p_ip_hash IS NULL OR p_ip_hash !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('ok',false); END IF;
 IF NOT dvnt_settlement.consume_guest_recovery_limit('exchange:global',3000) THEN RETURN jsonb_build_object('ok',false); END IF;
 IF NOT dvnt_settlement.consume_guest_recovery_limit('exchange:ip:'||p_ip_hash,30) THEN RETURN jsonb_build_object('ok',false); END IF;
 SELECT * INTO cap FROM dvnt_settlement.guest_recovery_capabilities WHERE capability_hash=p_capability_hash FOR UPDATE;
 IF NOT FOUND OR cap.expires_at<=now() OR cap.exchanged_at IS NOT NULL OR cap.purpose<>'replace_canceled_checkout'
 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=cap.order_id AND user_id IS NULL AND guest_email IS NOT NULL) THEN RETURN jsonb_build_object('ok',false); END IF;
 INSERT INTO dvnt_settlement.guest_recovery_sessions(order_id,capability_id,session_hash) VALUES(cap.order_id,cap.id,p_session_hash) RETURNING expires_at INTO expires;
 UPDATE dvnt_settlement.guest_recovery_capabilities SET exchanged_at=now() WHERE id=cap.id;
 RETURN jsonb_build_object('ok',true,'order_id',cap.order_id,'expires_at',expires);
END $$;
REVOKE ALL ON FUNCTION public.settlement_guest_recovery_exchange(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settlement_guest_recovery_exchange(text,text,text) TO service_role;

-- Called only inside the replacement transaction, after locking original order.
-- Returning an ID is identity proof, not a grant to create a payment. The caller
-- must also validate cancellation/financial state and consume in that transaction.
CREATE FUNCTION dvnt_settlement.validate_guest_recovery_session(p_order_id uuid,p_session_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s dvnt_settlement.guest_recovery_sessions%ROWTYPE;
BEGIN
 IF NOT coalesce((SELECT guest_checkout_recovery_enabled AND checkout_replacement_enabled FROM dvnt_settlement.controls WHERE singleton),false) THEN RAISE EXCEPTION 'guest recovery unavailable'; END IF;
 SELECT * INTO s FROM dvnt_settlement.guest_recovery_sessions WHERE order_id=p_order_id AND session_hash=p_session_hash FOR UPDATE;
 IF NOT FOUND OR s.expires_at<=now() OR s.consumed_at IS NOT NULL OR s.purpose<>'replace_canceled_checkout'
 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND user_id IS NULL AND guest_email IS NOT NULL) THEN RAISE EXCEPTION 'guest recovery unavailable'; END IF;
 RETURN s.id;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.validate_guest_recovery_session(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
