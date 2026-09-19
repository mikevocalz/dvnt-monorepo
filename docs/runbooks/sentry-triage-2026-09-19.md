# Sentry triage — September 19, 2026

Inspected the live `5th-galaxy-studios` organization through an authenticated
browser. Base commit: `bc00d16e643babd717ebbbd6179aa5fcd27ca7b2`.

| Issue | Observed evidence | Result |
| --- | --- | --- |
| [DVNT-WEB-S](https://5th-galaxy-studios.sentry.io/issues/7714119964/?project=4511776642170880) | 9 events, all production. `/settings/theme` calls `use-color-scheme.ts` → NativeWind → unavailable `Appearance.setColorScheme` on web. | Guard the native setter on web; preserve native behavior and the existing dark palette. |
| [DVNT-MOBILE-2](https://5th-galaxy-studios.sentry.io/issues/7713168192/?project=4511776736608256&query=&referrer=issue-stream&sort=recommended) | 14 events across 2 devices; all release `com.dvnt.app@1.0.0+1.0.343`, production. Expo `ErrorRecovery.crash` re-raises a fatal, but the original JS error is absent. | Root cause still unproven. Repair the persisted-report delivery path so a subsequent launch can report its original error. |
| DVNT-MOBILE-7 | One resolved connectivity probe; this is not evidence that device crash delivery works. | Excluded from real-crash counts. |
| DVNT-MOBILE-3/4/5/6 | Older hangs and invalid-hook-call reports, marked resolved in Sentry. | No claim that these explain the user's current repeated crashes. |
| DVNT-WEB-Y | Router initialization errors; observed issue distribution is 100% development. | Not treated as a production mobile crash. |
| [DVNT-EDGE-5](https://5th-galaxy-studios.sentry.io/issues/7733482002/?project=4511776737722368) | Active production watchdog alert for overdue `reconcile-orders`, last OK recorded at 2026-09-18T21:00:04.526861Z. | Outstanding backend incident. Requires the reconciler's underlying job/database outcome; the watchdog itself is reporting a failure, not causing an app crash. |

## Reporter defects repaired

- A successful JSON parse used to delete the JS/native record before any
  delivery result existed. Offline requests, a missing DSN, HTTP 429/5xx, or
  a stalled request could permanently lose it. Keep the source until Sentry
  accepts the envelope, with a five-second send deadline and retry on relaunch.
- The persistent signature was claimed before sending and suppressed later
  crashes with the same message forever. Record a receipt only after success,
  using the original timestamp to distinguish a new occurrence from a reread.
- Saved JS stacks lived only inside `detail`, while the sender read `stack` at
  the top level. Forward the stack, occurrence time, and unhandled flag into
  the Sentry event. Preserve nonfatal ErrorUtils severity.
- Compare the current source against the report sent before clearing it, so a
  newer error captured during delivery survives.
- Keep analytics delivery independent: an analytics insert cannot acknowledge
  a Sentry request, and an analytics failure cannot block Sentry delivery.

This continues using the existing JS envelope reporter. It does not restore
native SDK signal/hang capture, reconstruct already-deleted reports, or prove
that the installed mobile binary has the correct DSN. It retains the existing
one-record-per-source storage model, so another crash can still overwrite an
older unsent record. Lost HTTP acknowledgements can result in at-least-once
delivery.

## Validation and rollout status

```sh
node --test packages/app/lib/analytics/crash-delivery.test.ts \
  packages/app/lib/analytics/sentry-envelope.test.ts \
  packages/app/lib/analytics/report-issue.test.ts
git diff --check
```

18 tests pass on Node 24. The 8 new crash-delivery/theme regressions all fail
against the original source. Tests execute the actual application reporting
and hook modules, replacing only native/storage/network boundaries. They
cover JS and native source retention, offline and HTTP failures, missing DSN,
timeouts, acknowledgement races, occurrence deduplication, stack forwarding,
severity, and web/native theme behavior.

No full monorepo typecheck, web build, or physical iOS/Android run was performed
in this checkout. No release was deployed and no Sentry issue was resolved.
The original startup abort remains open until an affected device on the fixed
reporter supplies its JS error or native exception reason.
