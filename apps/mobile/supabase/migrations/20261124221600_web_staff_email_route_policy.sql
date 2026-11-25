-- Service-only web rate and ownership gates. Opt-in runtime; no jobs or sends.
BEGIN;
CREATE TABLE public.event_staff_email_rate_budget (
  actor text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('issue', 'claim', 'revoke')),
  window_id bigint NOT NULL,
  used integer NOT NULL CHECK (used >= 1),
  PRIMARY KEY (actor, operation)
);
ALTER TABLE public.event_staff_email_rate_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_staff_email_rate_budget FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.take_event_staff_email_budget(p_actor text, p_operation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_window bigint := floor(extract(epoch FROM clock_timestamp())/600);
  v_limit integer := CASE p_operation WHEN 'issue' THEN 8 WHEN 'claim' THEN 24 WHEN 'revoke' THEN 24 END;
BEGIN
  IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 1 AND 128 OR v_limit IS NULL THEN RETURN false; END IF;
  INSERT INTO public.event_staff_email_rate_budget AS b(actor, operation, window_id, used)
  VALUES (p_actor,p_operation,v_window,1)
  ON CONFLICT (actor,operation) DO UPDATE
  SET window_id=excluded.window_id, used=CASE WHEN b.window_id=excluded.window_id THEN b.used+1 ELSE 1 END
  WHERE b.window_id<excluded.window_id OR (b.window_id=excluded.window_id AND b.used<v_limit);
  RETURN FOUND;
END $$;

CREATE FUNCTION public.can_issue_event_staff_email_invite(p_event_id integer, p_actor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.host_id=p_actor AND e.status='active'
  )
$$;
REVOKE ALL ON FUNCTION public.take_event_staff_email_budget(text,text),
  public.can_issue_event_staff_email_invite(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.take_event_staff_email_budget(text,text),
  public.can_issue_event_staff_email_invite(integer,text) TO service_role;
COMMIT;
