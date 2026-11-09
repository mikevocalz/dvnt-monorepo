# PR210 source integration validation, 2026-11-09

Source-only review. No deployment, production migration, permission change,
credential change, account probe, PR merge or master modification was performed.

## Inputs and behavior

- PR210 input: `c09f29cb51da7a9c77dbe821554362bf8b0ab1f9`.
- Master incorporated locally: `d1f03d8b95e0f0aa0421b3d08453bbd509d2f73d`.
- Six conflicted files resolved while preserving newer pagination, read rollback,
  cohost navigation, bootstrap payload/cache behavior and visible-query refresh.
- Private identity/bridge/socket guards retained. Bootstrap CORS uses current
  shared wildcard behavior, avoiding the conflicting/duplicate header setup.
  A missing unread count is a visible failure rather than a fabricated zero.
- Auth-sync requires existing server-verified email only for a NULL-link claim.
  It preserves established links and normal new-profile creation; NULL-link CAS
  also checks unchanged email. It does not send a verification request or add a
  prompt. Future unlinked collisions without proof intentionally fail closed.
- Both SQL drafts remain under `docs/security`, outside auto-applied migrations.

## Passed locally

Node 24.22.1; TypeScript 5.9.3; Better Auth 1.6.26; PGlite 0.3.14.

1. Actual handler/client/transport/activity contracts: **171 passed, 0 failed,
   0 skipped**. Command from repository root:

```sh
NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node --test \
  packages/supabase/src/bridge-transport.test.ts \
  packages/supabase/src/realtime-auth.test.ts \
  packages/app/lib/api/notification-access.test.cjs \
  packages/app/lib/stores/activity-realtime-privacy.test.cjs \
  apps/mobile/supabase/functions/bootstrap-notifications/privacy.test.cjs \
  apps/mobile/supabase/functions/bootstrap-notifications/schema.test.cjs \
  apps/mobile/supabase/functions/auth-sync/identity-link.test.cjs \
  apps/mobile/supabase/functions/auth-sync/email-ownership.test.cjs \
  scripts/test-activity-live-refresh.cjs scripts/test-activity-read-state.cjs \
  scripts/test-activity-history.cjs scripts/test-activity-bootstrap.cjs \
  packages/app/lib/activity/*.test.ts packages/app/lib/activity/*.test.cjs \
  packages/app/lib/notifications/event-broadcast-routing.test.cjs \
  apps/mobile/supabase/functions/event-broadcast-message/index.test.cjs
```

The auth-sync subset has 28 handler tests. Three additional tests execute the
actual auth edge configuration and Better Auth routes, not a duplicate simplified
configuration. Database/email transport are synthetic. No external email is sent.

2. `DVNT_SQL_ENGINE=pglite NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node
   --test scripts/test-notification-privacy-sql.cjs`: **15 passed, 0 failed,
   1 explicit skip**. Exact SQL drafts execute with synthetic baseline grants,
   roles, RLS and rows. The skipped case needs multiple PostgreSQL connections;
   PGlite must not be presented as a concurrency proof.
3. `node scripts/test-ticket-notification-dom.cjs`: actual DTO plus mounted
   web/native rows, five ticket types and **20 repeated route assertions passed**.
4. `node scripts/test-unread-badge-boundaries.cjs`: passed exact counts, canonical
   recipient, bridge failure, error/missing counts, native root push invalidation.
5. `node scripts/check-unread-badges.cjs`: focused types and Rules of Hooks passed;
   three existing noInlineConfig warnings, no errors.
6. `node scripts/verify-edge-functions.mjs`: 183 shipped functions, zero unpinned
   or floating imports; passed.
7. Focused strict TypeScript for bridge-transport.ts and realtime-auth.ts passed.
   App boundary ESLint on all five affected client modules passed with zero
   warnings/errors. Syntax parsing on nine changed TypeScript modules passed.
8. `git diff --check origin/master HEAD`: PR-only diff passed. The imported
   master history contains three pre-existing whitespace warnings when compared
   against the old PR210 head; those unrelated master lines were not changed.

The environment supplies fixture dependencies through NODE_PATH and local
workspace package links. CI installs its own pinned dependencies; the workflow
retains real PostgreSQL as the default and includes the actual auth writer tests.

## Not passed / not run

- Default socket-only PostgreSQL command failed explicitly with
  `PostgreSQL server unavailable: notification privacy tests NOT RUN`. CI must
  verify the real multi-connection null/email CAS and all SQL policy assertions.
- Event notification Playwright DTO/bundle preflight completed, but Chromium
  launch failed at `socket() failed: Operation not permitted`. Browser interactions
  did not execute locally. Existing browser CI remains required.
- Full app `tsc --noEmit -p packages/app/tsconfig.json` is not green locally.
  After restoring local workspace resolution, the default 2GB run exhausted
  heap; a 4GB retry was killed with exit 137 before diagnostics. Focused checks
  do not substitute for a successful full typecheck in an adequate CI runner.
- No physical device, installed legacy binary, deployed auth bundle, real
  OAuth provider, production RLS application or live account behavior was tested.

See `notification-privacy-rollout.md` for source trust evidence, limitations,
separate identity/notification release gates, and the explicit live approval boundary.
