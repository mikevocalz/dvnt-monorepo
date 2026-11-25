-- Requires 20261124212500_web_ticket_guest_username.sql.
-- Match a checkout label ONLY on tickets without an account owner. A guest's
-- entered handle is not verified and is never joined to a user account.
BEGIN;
CREATE OR REPLACE FUNCTION public.normalize_event_ticket_lookup_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_raw text; v_digits text; v_result text;
BEGIN
 IF length(p_phone)>80 THEN RETURN NULL; END IF;
 v_raw:=regexp_replace(p_phone,'^\s+|\s+$','','g');
 IF v_raw !~ '^[0-9[:space:]().+-]+$' OR strpos(substr(v_raw,2),'+')>0 THEN RETURN NULL; END IF;
 v_digits:=regexp_replace(v_raw,'[^0-9]','','g');
 IF left(v_raw,1)='+' THEN v_result:='+'||v_digits;
 ELSIF left(v_raw,2)='00' THEN v_result:='+'||substr(v_digits,3);
 ELSIF length(v_digits)=10 THEN v_result:='+1'||v_digits;
 ELSIF length(v_digits)=11 AND left(v_digits,1)='1' THEN v_result:='+'||v_digits;
 ELSE RETURN NULL; END IF;
 IF v_result !~ '^\+[1-9][0-9]{7,14}$' THEN RETURN NULL; END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.normalize_event_ticket_lookup_phone(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_event_ticket_lookup_phone(text) TO service_role;

CREATE OR REPLACE FUNCTION public.lookup_event_tickets_contact(
 p_event_id integer,p_auth_id text,p_kind text,p_value text
) RETURNS SETOF public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_role text; v_value text := btrim(coalesce(p_value,''));
BEGIN
 IF p_auth_id IS NULL OR p_auth_id='' THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 SELECT CASE WHEN e.host_id=p_auth_id THEN 'owner' ELSE (
  SELECT c.role FROM public.event_co_organizers c WHERE c.event_id=e.id AND c.user_id=p_auth_id
   AND c.accepted=true AND c.role IN ('admin','editor','scanner') LIMIT 1) END
 INTO v_role FROM public.events e WHERE e.id=p_event_id;
 IF v_role IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 IF p_kind='email' THEN
  v_value:=lower(v_value);
  IF length(v_value)>254 OR v_value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
   RAISE invalid_parameter_value USING MESSAGE='Enter the complete email address';
  END IF;
 ELSIF p_kind='phone' THEN
  v_value:=public.normalize_event_ticket_lookup_phone(v_value);
  IF v_value IS NULL THEN RAISE invalid_parameter_value USING MESSAGE='Enter the complete phone number with country code'; END IF;
 ELSIF p_kind='username' THEN
  v_value:=lower(regexp_replace(v_value,'^@',''));
  IF v_value !~ '^[a-z0-9_.]{3,30}$' OR left(v_value,1)='.' OR right(v_value,1)='.' OR strpos(v_value,'..')>0 THEN
   RAISE invalid_parameter_value USING MESSAGE='Enter the complete username';
  END IF;
 ELSE RAISE invalid_parameter_value USING MESSAGE='Unknown contact type'; END IF;
 -- Serialize the existing shared rate-limit check/record so concurrent calls
 -- cannot defeat the per-staff, per-event lookup budget. No contact is logged.
 PERFORM pg_advisory_xact_lock(hashtextextended('ticket_contact:'||p_auth_id||':'||p_event_id,0));
 IF public.check_rate_limit(p_auth_id,'ticket_contact:'||p_event_id,NULL,30,60) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Contact lookup limit reached. Try again shortly.';
 END IF;
 PERFORM public.record_rate_limit(p_auth_id,'ticket_contact:'||p_event_id,NULL);
 RETURN QUERY SELECT t.* FROM public.tickets t
 LEFT JOIN public.web_ticket_guest_contacts c ON c.ticket_id=t.id
  AND c.order_id=t.order_id AND t.user_id IS NULL AND c.guest_email=lower(btrim(t.guest_email))
 WHERE t.event_id=p_event_id AND (
  (t.user_id IS NULL AND CASE p_kind
   WHEN 'email' THEN lower(btrim(t.guest_email))=v_value
   WHEN 'username' THEN c.guest_username=v_value
   WHEN 'phone' THEN coalesce(c.guest_phone,
    public.normalize_event_ticket_lookup_phone(t.guest_phone_e164),
    public.normalize_event_ticket_lookup_phone(t.guest_phone)
   )=v_value END)
  OR (t.user_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM public."user" a
   LEFT JOIN public.users u ON u.auth_id=a.id
   LEFT JOIN public.user_private_profile p ON p.auth_id=a.id
   WHERE a.id=t.user_id AND CASE p_kind
    WHEN 'email' THEN lower(btrim(a.email))=v_value
    WHEN 'username' THEN lower(btrim(u.username))=v_value
    WHEN 'phone' THEN p.phone_e164=v_value END
  ))
 );
END $$;
REVOKE ALL ON FUNCTION public.lookup_event_tickets_contact(integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_event_tickets_contact(integer,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
