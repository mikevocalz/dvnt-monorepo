-- Exact, event-scoped door lookup. Never expose stored contact fields.
-- This expands authorized event staff discovery: requires explicit rollout approval.
BEGIN;
CREATE OR REPLACE FUNCTION public.lookup_event_tickets_contact(
 p_event_id integer,p_auth_id text,p_kind text,p_value text
) RETURNS SETOF public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_role text; v_value text := btrim(coalesce(p_value,''));
BEGIN
 IF p_auth_id IS NULL OR p_auth_id='' THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 SELECT CASE WHEN e.host_id=p_auth_id THEN 'owner' ELSE (
  SELECT c.role FROM event_co_organizers c WHERE c.event_id=e.id AND c.user_id=p_auth_id
   AND c.accepted=true AND c.role IN ('admin','editor','scanner') LIMIT 1) END
 INTO v_role FROM events e WHERE e.id=p_event_id;
 IF v_role IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 IF p_kind='email' THEN
  v_value:=lower(v_value);
  IF length(v_value)>254 OR v_value !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
   RAISE invalid_parameter_value USING MESSAGE='Enter the complete email address';
  END IF;
 ELSIF p_kind='phone' THEN
  IF v_value !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE invalid_parameter_value USING MESSAGE='Enter the complete phone number with country code'; END IF;
 ELSE RAISE invalid_parameter_value USING MESSAGE='Unknown contact type'; END IF;
 -- Serialize the existing shared rate-limit check/record so concurrent calls
 -- cannot defeat the per-staff, per-event lookup budget. No contact is logged.
 PERFORM pg_advisory_xact_lock(hashtextextended('ticket_contact:'||p_auth_id||':'||p_event_id,0));
 IF public.check_rate_limit(p_auth_id,'ticket_contact:'||p_event_id,NULL,30,60) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Contact lookup limit reached. Try again shortly.';
 END IF;
 PERFORM public.record_rate_limit(p_auth_id,'ticket_contact:'||p_event_id,NULL);
 RETURN QUERY SELECT t.* FROM tickets t WHERE t.event_id=p_event_id AND (
  (t.user_id IS NULL AND CASE WHEN p_kind='email' THEN lower(btrim(t.guest_email))=v_value ELSE coalesce(t.guest_phone,t.guest_phone_e164)=v_value END)
  OR (t.user_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM users u LEFT JOIN user_private_profile p ON p.auth_id=u.auth_id
   WHERE u.auth_id=t.user_id AND CASE WHEN p_kind='email' THEN lower(btrim(u.email))=v_value ELSE p.phone_e164=v_value END
  ))
 );
END $$;
REVOKE ALL ON FUNCTION public.lookup_event_tickets_contact(integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_event_tickets_contact(integer,text,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
