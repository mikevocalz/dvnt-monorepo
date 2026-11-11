# Effective profile privacy presentation

## Problem and scope

Legacy accounts can have `users.is_private = false` while their saved
`privacy.privateAccount` is true. Post access already ORs both values, but profile
headers and locked-profile notices used only the first. This change reconciles
presentation with the existing authorization boundary. It does **not** establish
the cause of the reported Spicy-post reveal or claim that incident is resolved.

## Change

- `profile_is_private(bigint)` intentionally exposes only the public/private
  boolean already shown on profiles. It returns NULL for a missing app profile.
  It does not expose settings, identity information, follows, or content.
- Its empty search path and schema-qualified tables prevent object shadowing.
  Default PUBLIC execution is revoked; only anon/authenticated/service_role
  execution is granted. The definer privilege is necessary to read the private
  settings internally, not to expose those settings or change them.
- Shared and legacy profile lookups, including username, ID and auth-ID routes,
  use the effective value. Failed lookups do not fall through to Public defaults.
- Profile screens hide retained stale Public data on a privacy-read failure and
  offer retry. Bootstrap responses fail closed when the RPC is unavailable.
- No follow relationships, grants, approvals, settings, or content are rewritten.

## Release order (not performed by this PR)

1. Apply `20261111020731_profile_effective_privacy.sql` through the authorized
   migration workflow. Verify settings-only private, flag-only private, public,
   and unknown-profile responses under anon/authenticated roles.
2. Deploy `bootstrap-profile` and the web client. Distribute the native changes
   separately. Confirm signed-in and signed-out profile presentation, including
   a failed refresh with cached Public data and retry recovery.
3. Keep the additive RPC if rolling clients back. Do not remove it while clients
   using it remain deployed. Deploying clients before the migration intentionally
   produces an unavailable state, not an inaccurate Public profile.

## Regression checks

- `scripts/test-profile-effective-privacy-sql.cjs`: actual local PostgreSQL-WASM
  function execution, role grants, settings non-disclosure, legacy values.
- `scripts/test-profile-effective-privacy-api.cjs`: production shared/legacy API
  executions, lookup failures, and a real retained TanStack query cache.
- `packages/app/lib/profile/effective-profile-privacy.test.ts`: helper contract
  and both profile-screen unavailable guards.
- `scripts/test-spicy-follow-server.cjs`: real bootstrap handler presentation
  and no content payload on privacy lookup failure, plus existing post gates.

All accounts in these tests are synthetic. Live author/viewer reproduction and
physical-device acceptance are separate from these isolated tests.
