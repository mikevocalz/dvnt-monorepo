-- Source-only: no legacy grants are promoted to precise distance consent.
BEGIN;
CREATE TABLE public.member_exact_distance_consent (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES public.session(id) ON DELETE CASCADE,
  consent_version integer NOT NULL CHECK (consent_version = 2),
  consented_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.member_exact_distance_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_exact_distance_consent FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_exact_distance_consent TO service_role;
ALTER TABLE public.member_proximity_presence ADD COLUMN exact_session_id text REFERENCES public.session(id) ON DELETE CASCADE;
ALTER TABLE public.member_proximity_presence ADD COLUMN exact_observed_at timestamptz;
-- Validate at write time under the same master lock as legacy presence.
-- This serializes grant/publish with overall withdrawal, not just HTTP prechecks.
CREATE FUNCTION public.guard_exact_distance_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE enabled boolean; session_expiry timestamptz;
BEGIN
  SELECT location_enabled INTO enabled FROM public.member_map_settings
    WHERE user_id = NEW.user_id FOR UPDATE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location is disabled'; END IF;
  SELECT "expiresAt" INTO session_expiry FROM public.session
    WHERE id = NEW.session_id AND "userId" = NEW.user_id FOR KEY SHARE;
  IF session_expiry IS NULL OR session_expiry <= clock_timestamp() OR
     NEW.expires_at <= clock_timestamp() OR NEW.expires_at > session_expiry THEN
    RAISE EXCEPTION 'Live owned session required';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_exact_distance_consent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_exact_distance_consent BEFORE INSERT OR UPDATE
ON public.member_exact_distance_consent FOR EACH ROW EXECUTE FUNCTION public.guard_exact_distance_consent();

CREATE FUNCTION public.guard_exact_distance_presence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE enabled boolean; grant_expiry timestamptz; session_expiry timestamptz;
BEGIN
  IF NEW.exact_session_id IS NULL THEN NEW.exact_observed_at := NULL; RETURN NEW; END IF;
  SELECT location_enabled INTO enabled FROM public.member_map_settings
    WHERE user_id = NEW.user_id FOR UPDATE;
  IF enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location is disabled'; END IF;
  -- A concurrent consent DELETE either wins first (publish is rejected), or
  -- waits until this publish commits and then removes the presence itself.
  SELECT expires_at INTO grant_expiry FROM public.member_exact_distance_consent
    WHERE user_id = NEW.user_id AND session_id = NEW.exact_session_id AND consent_version = 2 FOR UPDATE;
  SELECT "expiresAt" INTO session_expiry FROM public.session
    WHERE id = NEW.exact_session_id AND "userId" = NEW.user_id FOR KEY SHARE;
  IF grant_expiry IS NULL OR grant_expiry <= clock_timestamp() OR
     session_expiry IS NULL OR session_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'Live exact distance consent required';
  END IF;
  IF NEW.exact_observed_at IS NULL OR NOT isfinite(NEW.exact_observed_at) OR
     NEW.exact_observed_at < clock_timestamp() - interval '60 seconds' OR
     NEW.exact_observed_at > clock_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION 'Fresh device observation required';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.exact_observed_at IS NOT NULL AND NEW.exact_observed_at <= OLD.exact_observed_at THEN
    RAISE EXCEPTION 'A newer device observation is required';
  END IF;
  IF NEW.share_until IS NULL OR NOT isfinite(NEW.share_until) OR NEW.share_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'Live observation retention required';
  END IF;
  NEW.share_until := LEAST(NEW.share_until, grant_expiry, session_expiry, NEW.exact_observed_at + interval '15 minutes');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_exact_distance_presence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_exact_distance_presence BEFORE INSERT OR UPDATE
ON public.member_proximity_presence FOR EACH ROW EXECUTE FUNCTION public.guard_exact_distance_presence();
CREATE FUNCTION public.withdraw_exact_distance_presence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.member_proximity_presence WHERE user_id = OLD.user_id AND exact_session_id = OLD.session_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_exact_distance_presence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER withdraw_exact_distance_presence AFTER DELETE
ON public.member_exact_distance_consent FOR EACH ROW EXECUTE FUNCTION public.withdraw_exact_distance_presence();

-- Turning overall location off must not leave a dormant exact grant that
-- silently comes back when the user enables ordinary location later.
CREATE FUNCTION public.withdraw_exact_distance_on_location_off() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.location_enabled IS NOT TRUE THEN
    DELETE FROM public.member_exact_distance_consent WHERE user_id = NEW.user_id;
    DELETE FROM public.member_proximity_presence WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_exact_distance_on_location_off() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER withdraw_exact_distance_on_location_off
AFTER UPDATE OF location_enabled ON public.member_map_settings
FOR EACH ROW EXECUTE FUNCTION public.withdraw_exact_distance_on_location_off();
COMMIT;
NOTIFY pgrst, 'reload schema';
