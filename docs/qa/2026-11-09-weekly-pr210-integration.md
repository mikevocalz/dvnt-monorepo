# Weekly fixes plus PR210: combined source validation

## Exact inputs

- Weekly source: `6307cfbc3f692bf488f930ca51b34c6f0ed8474c`.
- PR210 local source: `f1c0a864e43951e18d916cae87ea103da57afcf6`.
- Published PR210 counterpart reported by the coordinator:
  `f76b192887218754bb2358cf0b0ae289ef11c7db`, identical source tree.

This candidate locally combines the two sources. It does not merge either GitHub
PR, modify master, publish, deploy, apply live SQL, change permissions or alter
credentials. Later settings cache-revision and follow-gate refresh fixes are not
part of these inputs and need testing after integration.

## Automatic merge review

No textual conflicts occurred. All four automatic overlaps were reviewed:

- `bootstrap-notifications/index.ts` retains weekly protected-post projection,
  hidden thumbnail/comment/payload redaction, and PR210 verified recipient,
  bounded pagination, no-store headers, stable order and visible query failures.
- `notifications.ts` and `activity-store.ts` retain weekly event payload fields
  and PR210 identity/JWT/epoch checks, socket authentication and visible-query
  refresh callbacks. Newer pagination and read-state rollback remain covered.
- `test-event-notification-browser.cjs` retains verified-access assertions and
  weekly actor-profile versus activity-target click/Back expectations.

Auth-sync and shared bridge source match PR210 exactly. Weekly settings, follow,
location and protected-post source remain unchanged by this integration.

## Combined SQL proof

An additional case in `scripts/test-weekly-post-follow-sql.cjs` reads the actual
`docs/security/users-identity-write-prerequisite.sql`. It reproduces synthetic
writable-identity grants, proves the post gate refuses them atomically, applies
the exact prerequisite twice, and proves client identity/privacy writes denied
while profile reads and service writes remain available. It then executes the
actual private follow/post policies and verifies pending/approval/unfollow plus
the service settings trigger. Only afterward does it apply the actual optional
notification draft, checking own-only reads/read-state updates and content-write
and anonymous denial. The weekly behavior is verified before notification SQL;
notification-policy deployment is not made a prerequisite for weekly protections.

The test uses isolated PGlite roles and synthetic rows. The default standalone
notification SQL suite still requires real PostgreSQL for multi-connection CAS.
No test claims that source publication changes the installed database.

Existing weekly CI already invokes the expanded script; no new workflow was
added by this integration. Independent PR210 has no dependency on weekly fixtures.

## Local results

- Notification/auth/bridge/activity contracts: **172 passed, zero failed/skipped**.
  Same command as `../security/pr210-source-validation-2026-11-09.md`, evaluated
  against this combined tree (one additional weekly activity case).
- Weekly settings/follows/location/protected-post handler and mounted fixtures:
  **235 passed, zero failed/skipped**.
- Weekly post/private-follow/map-session/exact-distance/event SQL suites:
  **16 passed, zero failed/skipped**; includes the new actual-prerequisite test.
- Standalone notification SQL in explicit PGlite mode: **15 passed, one explicit
  real-PostgreSQL concurrency skip, zero failed**.
- Full app TypeScript: **passed, zero diagnostics**, with
  `NODE_OPTIONS=--max-old-space-size=4096 node_modules/.bin/tsc --noEmit -p packages/app/tsconfig.json`.
  The first run resolved root Node 20 types and reported eight fixture-only
  diagnostics. Restoring the existing package-local Node 26.2.0 types specified
  by the app manifest fixed resolution; no declared dependency/source changes.
- Mounted ticket/activity DOM: five ticket types, 20 repeated route assertions,
  post-ID fallback, profile/content separation and keyboard cases passed.
- Badge API boundary, focused badge types/hooks lint and affected-client boundary
  lint passed. Focused hook lint retains three existing noInlineConfig warnings.
- Edge static verification: 184 shipped functions, zero unpinned/floating imports.
- Integration `git diff --check HEAD` passed.

Exact focused weekly commands, from the repository root:

```sh
NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node --test --test-concurrency=2 \
  apps/mobile/supabase/functions/user-settings/index.test.cjs \
  apps/mobile/supabase/functions/toggle-follow/index.test.cjs \
  apps/mobile/supabase/functions/member-proximity/exact-consent.test.cjs \
  apps/mobile/supabase/functions/member-proximity/master-location.test.cjs \
  apps/mobile/supabase/functions/member-map/index.test.cjs \
  apps/mobile/supabase/functions/_shared/location-session.test.ts \
  packages/app/lib/api/follows-account.test.ts \
  scripts/test-user-settings-account-switch.cjs scripts/test-spicy-follow-server.cjs \
  scripts/test-follow-hook.cjs scripts/test-follow-requests-dom.cjs \
  scripts/test-weekly-post-share-metadata.cjs scripts/test-weekly-spicy-ui.cjs \
  scripts/test-member-map-session-dom.cjs scripts/test-exact-distance-hooks.cjs \
  scripts/test-proximity-observation-hooks.cjs \
  scripts/test-member-proximity-settings-dom.cjs \
  scripts/test-weekly-location-dom.cjs scripts/test-weekly-location-consent-dom.cjs

NODE_PATH=/tmp/dvnt-weekly-tools/node_modules node --test --test-concurrency=1 \
  scripts/test-weekly-post-follow-sql.cjs scripts/test-private-follow-requests-sql.cjs \
  scripts/test-member-map-session-sql.cjs scripts/test-exact-distance-sql.cjs \
  scripts/test-weekly-event-visibility-sql.cjs

DVNT_SQL_ENGINE=pglite NODE_PATH=/tmp/dvnt-weekly-tools/node_modules \
  node --test scripts/test-notification-privacy-sql.cjs
```

Physical-device QA, installed legacy compatibility and live provider/database
state remain outside this local source validation. Real PostgreSQL and Chromium
interaction coverage require the final published combined-head CI results.
