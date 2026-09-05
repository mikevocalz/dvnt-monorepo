-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260603183541 :: better_auth_account_table). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Better Auth's "account" table is the credential and OAuth-link store.
-- Without it, signups orphan a `user` row with no way to authenticate.
-- This is why every fresh signup returned 500 and the App Store reviewer
-- couldn't sign in to appreview@dvntapp.live — the user existed but no
-- password hash had ever been written anywhere.
--
-- Column shape is canonical per the Better Auth docs:
--   https://www.better-auth.com/docs/concepts/database#account-schema

CREATE TABLE IF NOT EXISTS public.account (
  id                       TEXT PRIMARY KEY,
  "accountId"              TEXT NOT NULL,
  "providerId"             TEXT NOT NULL,
  "userId"                 TEXT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  "accessToken"            TEXT,
  "refreshToken"           TEXT,
  "idToken"                TEXT,
  "accessTokenExpiresAt"   TIMESTAMPTZ,
  "refreshTokenExpiresAt"  TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_unique UNIQUE ("providerId", "accountId")
);

CREATE INDEX IF NOT EXISTS account_user_idx ON public.account ("userId");

GRANT ALL ON public.account TO service_role;
ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.account IS
  'Better Auth credential and OAuth provider records. providerId=credential rows store the email/password hash; providerId=apple etc. store linked OAuth identities.';;
