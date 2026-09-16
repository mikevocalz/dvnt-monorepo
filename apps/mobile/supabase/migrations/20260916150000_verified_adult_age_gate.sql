-- A provider approval is not sufficient without adult DOB evidence.
-- No existing records are deleted or rewritten. Old approvals with missing or
-- under-18 DOB stop authorizing verified access and can enter verification again.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_adult_identity_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'passed' THEN
    IF NEW.date_of_birth IS NULL OR NEW.date_of_birth > CURRENT_DATE
       OR NEW.date_of_birth <= (CURRENT_DATE - INTERVAL '121 years')::date THEN
      NEW.status := 'review';
      NEW.failure_code := 'age_evidence_missing';
      NEW.failure_message := 'A valid document date of birth is required for adult verification.';
    ELSIF NEW.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date THEN
      NEW.status := 'failed';
      NEW.failure_code := 'underage';
      NEW.failure_message := 'You must be 18 or older to use DVNT.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_adult_identity_verification ON public.identity_verifications;
CREATE TRIGGER enforce_adult_identity_verification
BEFORE INSERT OR UPDATE OF status, date_of_birth ON public.identity_verifications
FOR EACH ROW EXECUTE FUNCTION public.enforce_adult_identity_verification();

CREATE OR REPLACE FUNCTION public.is_verified(uid text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_claims json := NULLIF(current_setting('request.jwt.claims', true), '')::json;
BEGIN
  IF (v_claims ->> 'role') IS DISTINCT FROM 'service_role'
     AND uid IS DISTINCT FROM (v_claims ->> 'sub') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM identity_verifications
    WHERE user_id = uid AND status = 'passed'
      AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
      AND date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
  );
END;
$$;
REVOKE ALL ON FUNCTION public.is_verified(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_verified(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_verified_self()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM identity_verifications
    WHERE user_id = (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub')
      AND status = 'passed'
      AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
      AND date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
  );
$$;
REVOKE ALL ON FUNCTION public.is_verified_self() FROM public;
GRANT EXECUTE ON FUNCTION public.is_verified_self() TO authenticated, service_role;

COMMIT;
