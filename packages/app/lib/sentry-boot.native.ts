/**
 * Sentry boot — NATIVE fork. Deliberately a no-op.
 *
 * The mobile SDK was removed (2026-09-04). It was not earning its place:
 * `dvnt-mobile` held ZERO issues over 90 days while the app was crashing in
 * the field, which is the signature of a reporter that is not running rather
 * than an app that is not crashing — and `useNativeInit: true` put
 * `RNSentrySDK.init` into `MainApplication.onCreate` / the iOS AppDelegate
 * ahead of the JS bundle, which is both the earliest place a crash can happen
 * and the hardest place to see one.
 *
 * What it was actually being asked for — where people go, how long they stay,
 * which events pull traffic — it could never answer: `observability/flows/`
 * writes BREADCRUMBS, and a breadcrumb only ships attached to an error, so a
 * healthy session recorded nothing. That job now belongs to
 * `lib/analytics/` -> `analytics_events`, which records the healthy sessions
 * too.
 *
 * The web rail still runs Sentry through the Next instrumentation files; this
 * fork is native-only. To bring it back, restore this file from git history
 * AND re-add the plugin block in `apps/mobile/app.config.js` — then
 * `npx expo prebuild --clean`, because android/ and ios/ are committed
 * prebuild output and still carry whatever the plugin last wrote.
 */
export const Sentry = undefined;

export function bootSentry(): void {}

export function wrapRoot<T>(component: T): T {
  return component;
}
