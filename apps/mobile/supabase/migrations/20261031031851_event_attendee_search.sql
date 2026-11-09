-- Event-scoped roster search only. No ticket/profile mutation or global lookup.
BEGIN;
CREATE FUNCTION public.search_event_tickets(p_event_id integer,p_auth_id text,p_search text)
RETURNS SETOF public.tickets LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_role text;v_search text:=btrim(coalesce(p_search,''));v_handle text;v_pattern text;v_handle_pattern text;
BEGIN
 IF p_auth_id IS NULL OR p_auth_id='' THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 SELECT CASE WHEN e.host_id=p_auth_id THEN 'owner' ELSE (
 SELECT c.role FROM event_co_organizers c WHERE c.event_id=e.id AND c.user_id=p_auth_id
 AND c.accepted=true AND c.role IN ('admin','editor','scanner') LIMIT 1) END
 INTO v_role FROM events e WHERE e.id=p_event_id;
 IF v_role IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 IF length(v_search)>200 THEN RAISE invalid_parameter_value USING MESSAGE='Search must be 200 characters or fewer'; END IF;
 -- Wildcards and backslashes are literal user input; no SQL or PostgREST filter interpolation.
 v_handle:=CASE WHEN left(v_search,1)='@' AND length(v_search)>1 THEN substr(v_search,2) ELSE v_search END;
 v_pattern:=replace(replace(replace(v_search,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 v_handle_pattern:=replace(replace(replace(v_handle,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 RETURN QUERY SELECT t.* FROM tickets t WHERE t.event_id=p_event_id AND (
 v_search='' OR
 t.id::text ILIKE v_pattern||'%' OR t.qr_token ILIKE v_pattern||'%' OR
 CASE WHEN v_role='scanner' THEN
 -- Search only the holder identity the scanner can actually see. An attendee
 -- override must not become an oracle for hidden guest or account names.
 coalesce(nullif(btrim(t.attendee_name),''),CASE WHEN t.user_id IS NOT NULL
 THEN (SELECT u.username FROM users u WHERE u.auth_id=t.user_id LIMIT 1)
 ELSE t.guest_name END) ILIKE '%'||v_handle_pattern||'%'
 ELSE
 t.attendee_name ILIKE '%'||v_pattern||'%' OR t.guest_name ILIKE '%'||v_pattern||'%'
 OR EXISTS(SELECT 1 FROM users u WHERE u.auth_id=t.user_id AND (u.username ILIKE '%'||v_handle_pattern||'%'
 OR concat_ws(' ',nullif(btrim(u.first_name),''),nullif(btrim(u.last_name),'')) ILIKE '%'||v_pattern||'%'))
 END
 );
END $$;
REVOKE ALL ON FUNCTION public.search_event_tickets(integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_event_tickets(integer,text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
