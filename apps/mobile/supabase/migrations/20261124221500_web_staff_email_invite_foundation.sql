-- Dormant web email invitation storage and service-only RPCs. No sender,
-- route, scheduler, backfill, data import, or native behavior is wired here.
-- Never use event checkout contact data as verified staff identity.
BEGIN;
CREATE TABLE public.event_staff_email_invites (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  email_binding_hash bytea NOT NULL CHECK (octet_length(email_binding_hash) = 32),
  request_id uuid NOT NULL,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  issued_by text NOT NULL,
  offered_role text NOT NULL CHECK (offered_role IN ('admin', 'editor')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  claimed_by text,
  claimed_membership_id uuid,
  UNIQUE (event_id, issued_by, request_id),
  CHECK ((claimed_by IS NULL) = (claimed_membership_id IS NULL)),
  CHECK (claimed_by IS NULL OR closed_at IS NOT NULL)
);
ALTER TABLE public.event_staff_email_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_staff_email_invites FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.issue_event_staff_email_invite(
  p_event_id integer, p_actor text, p_email text, p_role text, p_request_id uuid, p_token text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_hash bytea;
  v_email_hash bytea;
  v_owner text;
  v_previous public.event_staff_email_invites%ROWTYPE;
BEGIN
  IF p_actor IS NULL OR p_actor = '' OR p_request_id IS NULL
    OR p_role IS NULL OR p_role NOT IN ('admin','editor')
    OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$'
    OR v_email IS NULL OR length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  THEN RETURN false; END IF;
  SELECT host_id INTO v_owner FROM public.events
   WHERE id = p_event_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_actor THEN RETURN false; END IF;
  v_hash := sha256(convert_to(p_token, 'UTF8'));
  v_email_hash := sha256(convert_to(p_token || ':' || v_email, 'UTF8'));
  SELECT * INTO v_previous FROM public.event_staff_email_invites
   WHERE event_id = p_event_id AND issued_by = p_actor AND request_id = p_request_id;
  IF FOUND THEN
    RETURN v_previous.token_hash = v_hash AND v_previous.email_binding_hash = v_email_hash
      AND v_previous.offered_role = p_role AND v_previous.closed_at IS NULL
      AND v_previous.expires_at > clock_timestamp();
  END IF;
  IF (SELECT count(*) FROM public.event_staff_email_invites
       WHERE event_id = p_event_id AND closed_at IS NULL AND expires_at > clock_timestamp()) >= 20
    THEN RETURN false; END IF;
  INSERT INTO public.event_staff_email_invites
    (token_hash, email_binding_hash, request_id, event_id, issued_by, offered_role, expires_at)
  VALUES (v_hash, v_email_hash, p_request_id, p_event_id, p_actor, p_role, clock_timestamp() + interval '24 hours')
  ON CONFLICT (token_hash) DO NOTHING;
  RETURN FOUND;
END $$;
CREATE FUNCTION public.claim_event_staff_email_invite(p_claimant text, p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_hash bytea;
  v_event_id integer;
  v_owner text;
  v_invite public.event_staff_email_invites%ROWTYPE;
  v_email text;
  v_membership_id uuid;
BEGIN
  IF p_claimant IS NULL OR p_claimant = ''
    OR p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$'
  THEN RETURN false; END IF;
  v_hash := sha256(convert_to(p_token, 'UTF8'));
  SELECT event_id INTO v_event_id FROM public.event_staff_email_invites WHERE token_hash = v_hash;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT host_id INTO v_owner FROM public.events
   WHERE id = v_event_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND OR v_owner IS NULL OR v_owner = p_claimant THEN RETURN false; END IF;
  SELECT * INTO v_invite FROM public.event_staff_email_invites
   WHERE token_hash = v_hash AND event_id = v_event_id FOR UPDATE;
  IF NOT FOUND OR v_invite.issued_by IS DISTINCT FROM v_owner THEN RETURN false; END IF;
  SELECT lower(btrim(email)) INTO v_email FROM public."user"
   WHERE id = p_claimant AND "emailVerified" IS TRUE FOR SHARE;
  IF v_email IS NULL OR sha256(convert_to(p_token || ':' || v_email,'UTF8')) <> v_invite.email_binding_hash
    THEN RETURN false; END IF;
  IF NOT COALESCE(public.is_verified(p_claimant), false)
    OR COALESCE(public.is_checkout_restricted(p_claimant), true)
    OR NOT EXISTS (SELECT 1 FROM public.verified_admission_policy p
                   WHERE p.id = 1 AND NOT p_claimant = ANY (p.denylist))
  THEN RETURN false; END IF;
  IF v_invite.closed_at IS NOT NULL THEN
    RETURN v_invite.claimed_by IS NOT DISTINCT FROM p_claimant AND EXISTS (
      SELECT 1 FROM public.event_co_organizers m
      WHERE m.id = v_invite.claimed_membership_id AND m.user_id = p_claimant
        AND m.event_id = v_event_id AND m.role = v_invite.offered_role AND m.accepted IS TRUE
    );
  END IF;
  IF v_invite.expires_at <= clock_timestamp() THEN RETURN false; END IF;
  INSERT INTO public.event_co_organizers AS m (event_id, user_id, role, invited_by, accepted)
    VALUES (v_event_id, p_claimant, v_invite.offered_role, v_owner, true)
    ON CONFLICT (event_id, user_id) DO NOTHING
    RETURNING m.id INTO v_membership_id;
  IF v_membership_id IS NULL THEN RETURN false; END IF;
  UPDATE public.event_staff_email_invites
     SET claimed_by = p_claimant, claimed_membership_id = v_membership_id, closed_at = clock_timestamp()
   WHERE token_hash = v_hash;
  RETURN true;
END $$;
CREATE FUNCTION public.revoke_event_staff_email_invite(p_event_id integer, p_actor text, p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_owner text;
BEGIN
  IF p_actor IS NULL OR p_actor = '' OR p_request_id IS NULL THEN RETURN false; END IF;
  SELECT host_id INTO v_owner FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_actor THEN RETURN false; END IF;
  UPDATE public.event_staff_email_invites SET closed_at = clock_timestamp()
   WHERE event_id = p_event_id AND issued_by = p_actor AND request_id = p_request_id AND closed_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.issue_event_staff_email_invite(integer,text,text,text,uuid,text),
  public.claim_event_staff_email_invite(text,text),
  public.revoke_event_staff_email_invite(integer,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_event_staff_email_invite(integer,text,text,text,uuid,text),
  public.claim_event_staff_email_invite(text,text),
  public.revoke_event_staff_email_invite(integer,text,uuid) TO service_role;

CREATE TABLE public.event_staff_email_outbox (
  delivery_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_hash bytea NOT NULL UNIQUE REFERENCES public.event_staff_email_invites(token_hash) ON DELETE CASCADE,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  issued_by text NOT NULL,
  request_id uuid NOT NULL,
  intent_digest bytea NOT NULL CHECK (octet_length(intent_digest) = 32),
  key_id text,
  nonce bytea,
  ciphertext bytea,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','provider_accepted','closed')),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  receipt text,
  UNIQUE(event_id, issued_by, request_id),
  CHECK ((state = 'leased') = (lease_token IS NOT NULL)),
  CHECK ((state = 'leased') = (lease_until IS NOT NULL)),
  CHECK ((state IN ('pending','leased')) = (key_id IS NOT NULL AND nonce IS NOT NULL AND ciphertext IS NOT NULL)),
  CHECK (key_id IS NULL OR key_id ~ '^[a-zA-Z0-9_-]{1,32}$'),
  CHECK (nonce IS NULL OR octet_length(nonce) = 12),
  CHECK (ciphertext IS NULL OR octet_length(ciphertext) BETWEEN 17 AND 65000),
  CHECK ((state = 'provider_accepted') = (receipt IS NOT NULL))
);
ALTER TABLE public.event_staff_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_staff_email_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX event_staff_email_outbox_due ON public.event_staff_email_outbox(next_attempt_at,delivery_id)
  WHERE state IN ('pending','leased');

CREATE FUNCTION public.queue_event_staff_email_invite(
  p_event integer,p_actor text,p_email text,p_role text,p_request uuid,p_token text,
  p_intent bytea,p_acceptable_intents bytea[],p_key_id text,p_nonce bytea,p_ciphertext bytea
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_owner text; v_old public.event_staff_email_outbox%ROWTYPE; v_id uuid;
BEGIN
  IF p_actor IS NULL OR p_request IS NULL OR p_intent IS NULL OR octet_length(p_intent) <> 32
    OR p_acceptable_intents IS NULL OR cardinality(p_acceptable_intents) NOT BETWEEN 1 AND 4
    OR NOT COALESCE(p_intent = ANY(p_acceptable_intents),false)
    OR p_key_id IS NULL OR p_key_id !~ '^[a-zA-Z0-9_-]{1,32}$'
    OR p_nonce IS NULL OR octet_length(p_nonce) <> 12
    OR p_ciphertext IS NULL OR octet_length(p_ciphertext) NOT BETWEEN 17 AND 65000
  THEN RETURN NULL; END IF;
  SELECT host_id INTO v_owner FROM public.events WHERE id=p_event AND status='active' FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_actor THEN RETURN NULL; END IF;
  SELECT * INTO v_old FROM public.event_staff_email_outbox
    WHERE event_id=p_event AND issued_by=p_actor AND request_id=p_request;
  IF FOUND THEN
    IF v_old.state <> 'closed' AND COALESCE(v_old.intent_digest = ANY(p_acceptable_intents),false)
      AND EXISTS (SELECT 1 FROM public.event_staff_email_invites i
                  WHERE i.token_hash=v_old.invite_hash AND i.closed_at IS NULL AND i.expires_at>clock_timestamp())
      THEN RETURN v_old.delivery_id;
    END IF;
    RETURN NULL;
  END IF;
  IF NOT public.issue_event_staff_email_invite(p_event,p_actor,p_email,p_role,p_request,p_token)
  THEN RETURN NULL; END IF;
  INSERT INTO public.event_staff_email_outbox(invite_hash,event_id,issued_by,request_id,intent_digest,key_id,nonce,ciphertext)
  VALUES (sha256(convert_to(p_token,'UTF8')),p_event,p_actor,p_request,p_intent,p_key_id,p_nonce,p_ciphertext)
  RETURNING delivery_id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.staff_email_delivery_authorized(p_delivery uuid,p_lease uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.event_staff_email_outbox o
  JOIN public.event_staff_email_invites i ON i.token_hash=o.invite_hash
  JOIN public.events e ON e.id=o.event_id
  WHERE o.delivery_id=p_delivery AND o.lease_token=p_lease AND o.state='leased'
    AND o.lease_until>clock_timestamp() AND o.created_at+interval '12 hours'>clock_timestamp()
    AND e.status='active' AND e.host_id=o.issued_by AND i.closed_at IS NULL AND i.expires_at>clock_timestamp()
 )
$$;

CREATE FUNCTION public.lease_staff_email_delivery()
RETURNS TABLE(delivery_id uuid,lease_token uuid,event_id integer,issued_by text,request_id uuid,
  invite_hash text,intent_digest text,key_id text,nonce text,ciphertext text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- Close invalid work and destroy ciphertext; limit each worker tick.
  WITH invalid AS (
    SELECT o.delivery_id FROM public.event_staff_email_outbox o
    JOIN public.event_staff_email_invites i ON i.token_hash=o.invite_hash
    JOIN public.events e ON e.id=o.event_id
    WHERE o.state IN ('pending','leased') AND
      (e.status<>'active' OR e.host_id IS DISTINCT FROM o.issued_by OR i.closed_at IS NOT NULL OR
       i.expires_at<=clock_timestamp() OR o.created_at+interval '12 hours'<=clock_timestamp())
    ORDER BY o.created_at LIMIT 50 FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.event_staff_email_outbox o
    SET state='closed',key_id=NULL,nonce=NULL,ciphertext=NULL,lease_token=NULL,lease_until=NULL
    FROM invalid q WHERE q.delivery_id=o.delivery_id;

  RETURN QUERY WITH eligible AS (
    SELECT o.delivery_id FROM public.event_staff_email_outbox o
    JOIN public.event_staff_email_invites i ON i.token_hash=o.invite_hash
    JOIN public.events e ON e.id=o.event_id
    WHERE ((o.state='pending' AND o.next_attempt_at<=clock_timestamp()) OR
           (o.state='leased' AND o.lease_until<=clock_timestamp()))
       AND e.status='active' AND e.host_id=o.issued_by AND i.closed_at IS NULL AND i.expires_at>clock_timestamp()
       AND o.created_at+interval '12 hours'>clock_timestamp()
    ORDER BY o.next_attempt_at,o.delivery_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.event_staff_email_outbox o
    SET state='leased',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',attempts=o.attempts+1
    FROM eligible q WHERE q.delivery_id=o.delivery_id
    RETURNING o.delivery_id,o.lease_token,o.event_id,o.issued_by,o.request_id,
      encode(o.invite_hash,'hex'),encode(o.intent_digest,'hex'),o.key_id,encode(o.nonce,'hex'),encode(o.ciphertext,'hex');
END $$;

CREATE FUNCTION public.finish_staff_email_delivery(p_delivery uuid,p_lease uuid,p_state text,p_receipt text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('retry','provider_accepted') OR
     (p_state='provider_accepted' AND (coalesce(length(btrim(p_receipt)),0) NOT BETWEEN 1 AND 128)) OR
     (p_state='retry' AND p_receipt IS NOT NULL)
  THEN RETURN false; END IF;
  UPDATE public.event_staff_email_outbox o SET
    state=CASE WHEN p_state='retry' THEN 'pending' ELSE p_state END,
    lease_token=NULL,lease_until=NULL,receipt=p_receipt,
    key_id=CASE WHEN p_state='retry' THEN o.key_id END,
    nonce=CASE WHEN p_state='retry' THEN o.nonce END,
    ciphertext=CASE WHEN p_state='retry' THEN o.ciphertext END,
    next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(300,30*o.attempts))
  WHERE o.delivery_id=p_delivery AND o.lease_token=p_lease AND o.state='leased' AND o.lease_until>clock_timestamp()
    AND public.staff_email_delivery_authorized(p_delivery,p_lease);
  RETURN FOUND;
END $$;

-- Issuance now always passes through the transactional outbox wrapper.
REVOKE EXECUTE ON FUNCTION public.issue_event_staff_email_invite(integer,text,text,text,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.queue_event_staff_email_invite(integer,text,text,text,uuid,text,bytea,bytea[],text,bytea,bytea),
  public.lease_staff_email_delivery(), public.staff_email_delivery_authorized(uuid,uuid),
  public.finish_staff_email_delivery(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_event_staff_email_invite(integer,text,text,text,uuid,text,bytea,bytea[],text,bytea,bytea),
  public.lease_staff_email_delivery(), public.staff_email_delivery_authorized(uuid,uuid),
  public.finish_staff_email_delivery(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.close_staff_email_delivery_for_closed_invite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  -- A revoked/claimed offer must lose pending delivery material in the same
  -- transaction. Preserve a recorded provider receipt; never requeue it.
  UPDATE public.event_staff_email_outbox o
  SET state='closed',key_id=NULL,nonce=NULL,ciphertext=NULL,lease_token=NULL,lease_until=NULL
  WHERE o.invite_hash=NEW.token_hash AND o.state IN ('pending','leased');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.close_staff_email_delivery_for_closed_invite()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER close_staff_email_outbox_on_invite_close
  AFTER UPDATE OF closed_at ON public.event_staff_email_invites
  FOR EACH ROW WHEN (OLD.closed_at IS NULL AND NEW.closed_at IS NOT NULL)
  EXECUTE FUNCTION public.close_staff_email_delivery_for_closed_invite();
COMMIT;
