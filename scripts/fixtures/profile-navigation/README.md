# Profile completion: real Next navigation regression

Run from the repository root after the normal workspace dependency install:

```sh
pnpm --filter web exec playwright install --with-deps chromium
node scripts/test-profile-completion-navigation.cjs
```

This creates an isolated temporary Next App Router application using the installed
Next version. It compiles the checkout's actual `SiteChrome`, `AppShell`,
`WebAppShell`, `WebTabBar`, `WebTopBar`, popup host, popup, Dialog, Solito navigation,
and React Native Web. It does **not** replace `next/navigation`, `next/link`, or
Solito's navigation implementation.

The fixture replaces authentication, the progress API, the Supabase JWT network
bridge, unread-count services, unrelated marketing chrome, and the native
CSS/semantic-element barrel. The dedicated unread-navigation-badges fixture
covers actual count hooks, query providers, realtime, and account transitions.
Accounts and responses are fictional. Browser network requests to origins other
than the fixture are blocked. It performs no live sign-in, uploads, or writes.

The generated app has two actual App Router route groups with separate layouts.
Desktop and mobile tests activate production primary navigation controls twice,
use a real Next Link across groups, then browser Back/Forward. They assert:

- The same browser document survives every ordinary navigation.
- Confirmed members see no additional popup insertion or progress read.
- Equal-value auth replacement and ordinary avatar/count cache churn preserve proof.
- Unmounting/remounting the actual dynamic popup host preserves proof.
- Same-member logout/login while the host is absent invalidates proof.
- An explicit same-ID auth-session replacement invalidates proof.
- Confirmed post/photo mutations invalidate proof and show the server-required step.
- A deliberate document reload performs a fresh authoritative check.

Popup insertion is observed from before application startup, not inferred from a
final screenshot. JSON evidence includes document requests, route checkpoints,
request counts, popup appearances, host mounts and route-group mounts. A failing
assertion exits nonzero; browser launch failure is never reported as a pass.

## Options

- `PROFILE_NAVIGATION_EVIDENCE=/path/report.json`: evidence output (default:
  `/tmp/dvnt-profile-navigation-evidence.json`).
- `NODE_PATH=/existing/node_modules`: use existing read-only test dependencies.
  No package or lockfiles are changed in the checkout.
- `CHROMIUM_EXECUTABLE_PATH=/path/chromium`: browser executable override.
- `PROFILE_NAVIGATION_VERBOSE=1`: stream Next output.
- `PROFILE_NAVIGATION_KEEP_FIXTURE=1`: retain generated application files.
- `node scripts/test-profile-completion-navigation.cjs --serve`: serve the fixture
  for inspection. Its collapsed control panel can remount the host, replace an
  auth snapshot, and simulate confirmed writes.
- `PROFILE_NAVIGATION_BASE_URL=http://127.0.0.1:PORT node
  scripts/test-profile-completion-navigation.cjs`: test an already running fixture.
- `--prepare-only`: generate the temporary fixture without starting a server.

The fixture is an integration test for routing and completion state. It does not
exercise the production auth provider, Supabase, unrelated page screens, or a
production optimized build. A full browser-capable environment is required;
containers that deny Chromium's local Unix sockets cannot run its assertions.

## Red/green baseline

`baseline-popup.tsx` is a byte-for-byte copy of
`apps/web/src/components/profile-completion-popup.tsx` at commit
`6cf253cead571f8a280d9d5bee746c5c212b4b63`. It is never imported by the app or by the
normal fixed-code test. To verify that the regression harness detects the old bug:

```sh
node scripts/test-profile-completion-navigation.cjs --baseline-regression
node scripts/test-profile-completion-navigation.cjs
```

Baseline mode narrowly swaps the popup imported by the actual production host.
It expects the old code to issue another read after clicking Events and to
reinsert the checking dialog after a real host unmount/remount, while retaining
the same browser document. Baseline mode fails if those defects are absent. The
normal run then requires zero extra reads/popups over the broader test matrix.
This makes baseline reproduction an executable assertion, rather than treating
any failing test as proof of the defect. Its evidence defaults to
`/tmp/dvnt-profile-navigation-baseline-evidence.json`.

`PROFILE_NAVIGATION_POPUP_PATH=/absolute/path/popup.tsx` can override this one
production import for an additional comparison. It does not replace the router,
host, shells, policy, Dialog, or state fixtures. When testing an already served
fixture, start that server with the same baseline/override option.
