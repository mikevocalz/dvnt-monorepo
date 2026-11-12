BEGIN;
-- No event is approved by this migration. Review policy, timezone and cohort
-- explicitly before writing a row. Seconds-based timing is not business days.
CREATE TABLE dvnt_settlement.release_policies (
 event_id int PRIMARY KEY REFERENCES public.events(id),
 policy text NOT NULL CHECK(policy='end_plus_five_business_days'),
 timezone text NOT NULL,
 review_reference text NOT NULL CHECK(length(trim(review_reference)) BETWEEN 8 AND 300)
);
ALTER TABLE dvnt_settlement.release_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.release_policies FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dvnt_settlement.event_release_at(p_event int) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p dvnt_settlement.release_policies%ROWTYPE; e public.events%ROWTYPE;
 canonical_end timestamptz; local_end timestamp; n int:=0; result timestamptz;
BEGIN
 SELECT * INTO p FROM dvnt_settlement.release_policies WHERE event_id=p_event;
 IF NOT FOUND THEN RAISE EXCEPTION 'release policy not configured for event'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p.timezone) THEN RAISE EXCEPTION 'release timezone not reviewed'; END IF;
 SELECT * INTO STRICT e FROM public.events WHERE id=p_event;
 canonical_end:=coalesce(e.end_date::timestamptz,e.start_date::timestamptz+interval '6 hours');
 IF canonical_end IS NULL OR NOT isfinite(canonical_end) THEN RAISE EXCEPTION 'event end missing'; END IF;
 local_end:=canonical_end AT TIME ZONE p.timezone;
 WHILE n<5 LOOP
  local_end:=local_end+interval '1 day';
  IF extract(isodow FROM local_end)<6 THEN n:=n+1; END IF;
 END LOOP;
 result:=local_end AT TIME ZONE p.timezone;
 IF e.payout_release_at IS NOT NULL AND NOT isfinite(e.payout_release_at) THEN RAISE EXCEPTION 'release date invalid'; END IF;
 RETURN greatest(result,e.payout_release_at);
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.event_release_at(int) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
