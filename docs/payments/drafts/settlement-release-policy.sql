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
-- Opt-in per future event. No default rows; never reuse the legacy release
-- column to write dates. The reviewed calendar must explicitly cover the
-- event's local end and every day counted, including cross-year rollover.
CREATE TABLE dvnt_settlement.promoter_release_policies (
 event_id int PRIMARY KEY REFERENCES public.events(id),
 effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),
 reviewed_end_at timestamptz NOT NULL CHECK(isfinite(reviewed_end_at) AND reviewed_end_at>effective_at),
 timezone text NOT NULL,
 calendar_from date NOT NULL CHECK(isfinite(calendar_from)),
 calendar_through date NOT NULL CHECK(isfinite(calendar_through) AND calendar_through>=calendar_from),
 closed_dates date[] NOT NULL CHECK(array_position(closed_dates,NULL) IS NULL),
 review_reference text NOT NULL CHECK(length(trim(review_reference)) BETWEEN 8 AND 300)
);
ALTER TABLE dvnt_settlement.promoter_release_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.promoter_release_policies FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION dvnt_settlement.event_promoter_release_at(p_event int,p_checkout_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE p dvnt_settlement.promoter_release_policies%ROWTYPE; e public.events%ROWTYPE;
 local_day date; n int:=0; checked_days int:=0;
BEGIN
 SELECT * INTO p FROM dvnt_settlement.promoter_release_policies WHERE event_id=p_event;
 IF NOT FOUND OR p_checkout_at<p.effective_at THEN RETURN NULL; END IF;
 SELECT * INTO STRICT e FROM public.events WHERE id=p_event;
 IF e.start_date IS NOT NULL AND isfinite(e.start_date) AND e.start_date<p.effective_at THEN RETURN NULL; END IF;
 -- An enabled but incomplete/mismatched review blocks payment, not checkout.
 IF e.start_date IS NULL OR NOT isfinite(e.start_date) OR e.end_date IS DISTINCT FROM p.reviewed_end_at
  OR e.end_date<=e.start_date
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p.timezone)
  OR EXISTS(SELECT 1 FROM unnest(p.closed_dates) d WHERE d<p.calendar_from OR d>p.calendar_through)
  OR (e.payout_release_at IS NOT NULL AND NOT isfinite(e.payout_release_at))
 THEN RETURN 'infinity'; END IF;
 local_day:=(e.end_date AT TIME ZONE p.timezone)::date;
 IF local_day NOT BETWEEN p.calendar_from AND p.calendar_through THEN RETURN 'infinity'; END IF;
 WHILE n<2 LOOP
  local_day:=local_day+1; checked_days:=checked_days+1;
  IF checked_days>31 OR local_day>p.calendar_through THEN RETURN 'infinity'; END IF;
  IF extract(isodow FROM local_day)<6 AND NOT (local_day=ANY(p.closed_dates)) THEN n:=n+1; END IF;
 END LOOP;
 RETURN greatest(local_day::timestamp AT TIME ZONE p.timezone,e.payout_release_at);
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.event_promoter_release_at(int,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

-- -infinity is an opted-in, unverified freeze; a complete current review
-- is mandatory before it can become payable. Null means no early release.
CREATE FUNCTION dvnt_settlement.freeze_promoter_release_at(p_event int,p_checkout_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN candidate='infinity' THEN '-infinity'::timestamptz ELSE candidate END
 FROM (SELECT dvnt_settlement.event_promoter_release_at(p_event,p_checkout_at) candidate) r;
$$;
REVOKE ALL ON FUNCTION dvnt_settlement.freeze_promoter_release_at(int,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION dvnt_settlement.checkout_promoter_release_at(p_event int,p_frozen timestamptz,p_checkout_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_frozen IS NULL THEN NULL ELSE
  greatest(coalesce(dvnt_settlement.event_promoter_release_at(p_event,p_checkout_at),'infinity'),p_frozen) END;
$$;
REVOKE ALL ON FUNCTION dvnt_settlement.checkout_promoter_release_at(int,timestamptz,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION dvnt_settlement.allocation_release_at(p_order uuid,p_role text,p_organizer_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE promoter_at timestamptz;
BEGIN
 IF p_role='promoter' THEN
  SELECT dvnt_settlement.checkout_promoter_release_at(o.event_id,c.promoter_release_not_before,c.created_at)
    INTO promoter_at FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id WHERE c.order_id=p_order;
 END IF;
 RETURN coalesce(promoter_at,p_organizer_at);
END $$;
COMMIT;
