-- One MVCC snapshot of authorized aggregate counts. No roster, QR or location data.
-- Tier ranks and eligibility mirror get-event-tickets, the existing perk authority.
CREATE OR REPLACE FUNCTION public.watch_door_summary(p_event_id bigint, p_auth_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
WITH event AS (
  SELECT e.id, e.title, e.status, e.perk_config,
    e.host_id = p_auth_id OR EXISTS (
      SELECT 1 FROM public.event_co_organizers c WHERE c.event_id = e.id
        AND c.user_id = p_auth_id AND c.accepted = true AND c.role IN ('admin','editor','scanner')
    ) AS allowed
  FROM public.events e WHERE e.id = p_event_id
), authorized AS (
  SELECT *, CASE
    WHEN jsonb_typeof(perk_config->'skip_line') = 'null' THEN NULL
    WHEN jsonb_typeof(perk_config->'skip_line') = 'number' THEN (perk_config->>'skip_line')::numeric
    ELSE 4 END AS priority_min
  FROM event WHERE allowed AND status = 'active'
), roster AS (
  SELECT t.id, t.user_id, t.event_id,
    (t.status = 'scanned' OR t.checked_in_at IS NOT NULL) AS admitted,
    EXISTS (
      SELECT 1 FROM public.membership_subscriptions s
      WHERE s.user_id = t.user_id
        AND (s.status = 'active'
          OR (s.status = 'past_due' AND s.grace_period_ends_at > now())
          OR (s.status = 'canceled' AND s.cancel_at_period_end AND s.current_period_end > now()))
        AND CASE s.plan_key
          WHEN 'free' THEN 0 WHEN 'sneaky_tier_1' THEN 1 WHEN 'sneaky_tier_2' THEN 2
          WHEN 'dvnt_core' THEN 3 WHEN 'dvnt_insider' THEN 4 WHEN 'dvnt_vip' THEN 5
          WHEN 'dvnt_founders_circle' THEN 6 ELSE NULL END >= a.priority_min
    ) AS priority,
    EXISTS (
      SELECT 1 FROM public.event_presence p
      WHERE p.event_id = t.event_id AND p.ticket_id = t.id AND p.user_id = t.user_id
        AND p.state = 'approaching' AND p.expires_at > now()
    ) AS approaching
  FROM public.tickets t JOIN authorized a ON a.id = t.event_id
  WHERE t.status IN ('active','scanned','transfer_pending')
), counts AS (
  SELECT count(*) AS expected, count(*) FILTER (WHERE admitted) AS arrived,
    count(*) FILTER (WHERE NOT admitted AND priority) AS priority_lane,
    count(*) FILTER (WHERE NOT admitted AND approaching) AS approaching
  FROM roster
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM event) THEN jsonb_build_object('ok',false,'code','not_found')
  WHEN NOT EXISTS (SELECT 1 FROM event WHERE allowed) THEN jsonb_build_object('ok',false,'code','forbidden')
  WHEN NOT EXISTS (SELECT 1 FROM authorized) THEN jsonb_build_object('ok',false,'code','not_active')
  ELSE (SELECT jsonb_build_object('ok',true,'summary',jsonb_build_object(
    'eventId',a.id::text,'eventTitle',a.title,'expected',c.expected,'arrived',c.arrived,
    'remaining',c.expected-c.arrived,'priorityLane',c.priority_lane,'approaching',c.approaching))
    FROM authorized a CROSS JOIN counts c)
END;
$$;
REVOKE ALL ON FUNCTION public.watch_door_summary(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.watch_door_summary(bigint,text) TO service_role;
