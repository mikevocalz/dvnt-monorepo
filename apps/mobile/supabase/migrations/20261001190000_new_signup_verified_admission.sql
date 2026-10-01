-- New accounts must complete adult identity verification before participation.
-- Existing members are grandfathered by the cohort boundary.
--
-- This intentionally does NOT prevent sign-in: a newly-created member must be
-- able to reach the verification flow. Participation writes are what fail
-- closed until identity_verifications is passed with adult DOB evidence.
BEGIN;

UPDATE public.verified_admission_policy
SET
  enforce = true,
  cohort_created_after = now(),
  grace_deadline = now(),
  updated_at = now()
WHERE id = 1;

COMMENT ON TABLE public.verified_admission_policy IS
  'Verified-only participation policy. Accounts created before cohort_created_after stay grandfathered unless denylisted.';

COMMIT;

NOTIFY pgrst, 'reload schema';
