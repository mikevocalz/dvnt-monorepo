-- Add 'didit' as an allowed identity-verification provider. Didit offers a
-- free hosted KYC flow (gov-ID + selfie + liveness); the schema is
-- provider-neutral, only the CHECK enumerated the rails. Everything else
-- (upsert_identity_verification, verification_events, is_verified*, RLS) is
-- reused unchanged.
ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS identity_verifications_provider_check;
ALTER TABLE identity_verifications
  ADD CONSTRAINT identity_verifications_provider_check
  CHECK (provider IN ('persona','veriff','onfido','yoti','didit'));
