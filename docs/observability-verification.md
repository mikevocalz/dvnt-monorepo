# Observability WS-5 — Verification & Operational Patterns

**Date:** 2026-08-09. **Lane:** `packages/observability` + `apps/web` Sentry configs + docs.
**Plan:** free Developer tier, LOCKED (sentry-budget.md). Everything here is either zero
incremental quota (metadata / sampling / logs into unused 5 GB) or a dashboard/CI step.

This doc covers the products WS-5 turned on and the standing patterns for verifying them.
Span-math proof + budget table live in [sentry-budget.md](./sentry-budget.md); the shipped
sampler map lives in `packages/observability/src/sampling.ts`.

All SDK claims below are cited against installed `node_modules` — `@sentry/nextjs` /
`@sentry/core` **10.69.0**, `@sentry/react-native` **8.22.0**, `sentry-cli` **2.58.6**.

---

## 1 · Funnels via `tracesSampler` (code — SHIPPED)

**What:** one shared `dvntTracesSampler` + route→rate table, imported by all three web
Sentry configs so the funnel-sampling policy lives in one place.

- Map + span-math proof (inline comment): `packages/observability/src/sampling.ts`
- Wired: `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts`,
  `apps/web/src/instrumentation-client.ts` (all replaced their inline
  `onboarding|welcome|verification|checkout|auth → 1.0 / 0.15` sampler with the shared one).

**Policy:** money paths (checkout end-to-end, billing/purchases/orders), signup/onboarding,
verification, auth, Sneaky Lynk join, media upload → **1.0**; health probes, `.well-known`,
feed-poll/presence/heartbeat → **0**; everything else → **0.15** (via `inheritOrSampleWith`
so a parent-sampled distributed trace stays coherent browser → server → edge → Supabase edge fn).

**SDK verification (file:line):**
- `tracesSampler?: (samplingContext: TracesSamplerSamplingContext) => number | boolean`
  — `node_modules/@sentry/core/build/types/types/options.d.ts:585`
- `TracesSamplerSamplingContext extends SamplingContext` — fields `name: string`,
  `attributes?`, `parentSampled?`, `parentSampleRate?`, `location?`, `normalizedRequest?`,
  `inheritOrSampleWith: (fallbackSampleRate: number) => number`
  — `node_modules/@sentry/core/build/types/types/samplingcontext.d.ts`

We read only `name` + `inheritOrSampleWith` (structural subset `DvntSamplingContext`), so the
fn stays assignable to the SDK slot; `apps/web` tsc verifies that at each `Sentry.init` call.

**Server/edge vs client:** the sampler is now on **all three** web runtimes (preferred over a
flat `tracesSampleRate`). Middleware (edge) runs on every request, so the chatty→0 rules pay
off most there. Mobile keeps its own inline boost sampler (`packages/app/lib/sentry-boot.native.ts:47-51`,
document-only per budget §3) — its `ctx.name` shape differs and it has no `.well-known`/probe routes.

---

## 2 · Logs (0/5 GB → home for webhook outcomes + funnel breadcrumbs) — code + config

**Structured logging EXISTS in the installed SDK** (no invention needed):
- `Sentry.logger` namespace `trace|debug|info|warn|error|fatal(message, attributes?, metadata?)`
  — `@sentry/core` `build/types/shared-exports.d.ts:90` (`export * as logger from './logs/public-api'`),
  method sigs at `build/types/logs/public-api.d.ts:35,63,90,120,150,180`
- re-exported by `@sentry/nextjs` `build/types/index.types.d.ts:26`
- re-exported by `@sentry/react-native` 8.22.0 `dist/js/index.d.ts:7` (via `@sentry/browser`)
- gated behind top-level `enableLogs?: boolean` — `@sentry/core` `build/types/types/options.d.ts:530`
- `Log.attributes?: Record<string, unknown>`, `SerializedLog.trace_id?` (auto trace-correlation)
  — `build/types/types/log.d.ts`

**Seam:** `packages/observability/src/logs.ts` — `emitLog(level, msg, attributes?, sampleRate?)`,
`logWebhookOutcome(webhook, 'ok'|'skipped'|'duplicate'|'failed', attrs?)`,
`logFunnelStep(flow, step, 'started'|'success'|'failure', attrs?, sampleRate?)`.
Attributes are run through the §2.4 redaction (`sanitizeForSentry`) before send. If the injected
SDK has no `logger` (older build / `enableLogs` off), every helper **degrades to a breadcrumb** —
never throws, never invents an API. Logs emitted inside an active span auto-correlate to the trace.

**Wiring:**
- `enableLogs: true` set on `apps/web` server/edge/client configs.
- `enableLogs?` added as a passthrough option (default **false**) to `init/web.ts` + `init/expo.ts`
  so mobile/vite-web opt in without a forced behavior change.
- The analytics↔Sentry bridge (`bridge.ts`) now emits a `logFunnelStep` alongside its breadcrumb:
  failures always log (error); started/success are **sampled at 0.1** so a busy funnel can't
  flood 5 GB.

**Webhook outcomes → logs (adoption pattern for the parallel edge-fn agent):** edge functions
(`stripe-webhook`, `purchases`, `promotion-webhook`, `notify-sale-open`, CMS `/app/sync`) are
owned by the jobs agent. The shared shape is `logWebhookOutcome(name, outcome, { eventId,
idempotencyKey, latencyMs })` inside the handler's span. Edge uses `@sentry/deno@10` (floating
pin, resolves to 10.69.x) — same `Sentry.logger` + `enableLogs`. Not wired here (out of lane).

**Activation note for Next web logs:** the Next configs call `Sentry.init` directly (not
`initObservability`), so the `logs.ts` seam's injected instance is unset in `apps/web`. The web
funnel logs fire once `initObservability(Sentry)` is called in the web bootstrap, OR call
`Sentry.logger.*` directly. `enableLogs: true` is already set, so the product is armed either way.

---

## 3 · Release health + OTA (metadata — no new quota)

`release` groups by build; `dist` groups by artifact — together they give crash-free
sessions/users **per build AND per OTA**.

- **Web (code, SHIPPED):** `release: SENTRY_RELEASE` + `dist: NEXT_PUBLIC_SENTRY_DIST ||
  VERCEL_DEPLOYMENT_ID` on server/edge; `dist: NEXT_PUBLIC_SENTRY_DIST` on client (only
  `NEXT_PUBLIC_*` reach the browser). Web has no OTA; `dist` is the per-deploy analog.
- **Mobile (`init/expo.ts`, SHIPPED as metadata):** `release = com.dvnt.app@<version>+<build>`
  (`buildReleaseString`), `dist = expoUpdateId ?? buildNumber` — when an EAS Update is live,
  `dist` becomes the Update id, so each OTA reports its own crash-free rate against the same
  native build. `release.ts` also sets `expoUpdateId`/`updateChannel`/`runtimeVersion` tags +
  the `dvnt_release` context, and `updateOTAInfo(updateId, channel)` refreshes them when
  `expo-updates` swaps an update in without a restart.
- **Source maps / native symbols:** `@sentry/react-native/expo` plugin
  (`apps/mobile/app.config.js:279-283`, org `5th-galaxy-studios`, project `dvnt-mobile`) needs
  `SENTRY_AUTH_TOKEN` in EAS secrets. Web uses `SENTRY_RELEASE` at build.

**Resolve-in-release convention (`Fixes DVNT-*`):** when a commit/PR fixes a Sentry issue,
put its short-id in the message — `Fixes DVNT-WEB-6` (or `Fixes DVNT-MOBILE-12`). Sentry's
commit-tracking marks the issue **resolved in the next release** and **auto-regresses** it
(reopens + alerts) if the fingerprint recurs in a later release. Requires the release to carry
commit data (source-map/release step already uploads it). This is the free, load-bearing signal
behind §5's regression check.

---

## 4 · Size Analysis (0/100 builds — config + CI step, no build run here)

Feeds the modernization prompt's bundle-size budgets at zero incremental cost.

**Verified mechanism (`sentry-cli` 2.58.6):**
`sentry-cli build upload <PATH>...` — "Upload builds to a project. Supported files: Apk, Aab,
XCArchive, IPA" (`node_modules/.bin/sentry-cli build upload --help`). Flags: `--org`,
`--project`, `--auth-token`, `--head-sha`/`--base-sha`, `--pr-number` (auto-detected inside a
`pull_request` GitHub Actions run).

**Wiring (documented, do NOT run a build):** after `eas build` produces the artifact, add a CI /
EAS-Workflow step:

```bash
npx sentry-cli build upload "$ARTIFACT_PATH" \
  --org 5th-galaxy-studios --project dvnt-mobile \
  --auth-token "$SENTRY_AUTH_TOKEN"
# $ARTIFACT_PATH = the .ipa (iOS) or .aab/.apk (Android) EAS produced.
```

- `SENTRY_AUTH_TOKEN` is already required for the source-map/native-symbol step (app.config.js
  note), so no new secret. Put it in EAS secrets / the CI env.
- `eas.json` has no native `postBuild` hook — run the upload as a step in an **EAS Workflow**
  (`.eas/workflows/*.yml`) or a GitHub Action that runs after the build job and downloads the
  artifact. Pass `--pr-number` (or let it auto-detect) so Size Analysis attaches PR diffs.
- **Unverifiable-by-name here:** the exact Size-Analysis dashboard path (Settings → the project →
  the size/build view) and whether a per-project toggle must be flipped first — confirm in the
  Sentry UI when a scoped token is available. The upload CLI itself is verified above.

---

## 5 · MCP regression-check pattern (standing pattern — documented, blocked on token)

**Pattern:** after a deploy that touches an area, before closing the workstream, query Sentry
(MCP) for **new-issue regressions in that area** — e.g. issues first-seen after the deploy's
release, filtered by the area's `featureArea`/route/`flow` tag. If the fix carried `Fixes DVNT-*`
(§3), Sentry auto-regresses the specific issue; the MCP query catches *new siblings* the resolve
didn't cover. **Seer** (AI root-cause / fix) is **on-demand only, for high-value issues** — money
paths, crash-loops, verification blockers — not a blanket scan.

Concrete query shape (via `mcp__sentry__search_issues` / `search_events`, org
`5th-galaxy-studios`):
- `is:unresolved firstSeen:-24h` scoped to the touched area, e.g.
  `featureArea:checkout`, `flow:sneaky_link`, or `transaction:"POST /api/checkout/session"`.
- Cross-check crash-free by release/`dist` (§3) to catch a spike a single issue query misses.

**Blocker (verified):** the Sentry MCP returned **HTTP 403** for this account's token on
2026-08-05 and again on 2026-08-08 (`search_issues`) — see observability-baseline.md header +
budget doc §5. So this pattern is **documented for when a scoped token is available**; until then
the same checks run through the Payload admin Sentry-Health screen (the LOCKED surface, §6) which
proxies the Sentry API server-side with the internal-integration token.

---

## 6 · Uptime monitor + metrics (dashboard steps — documented)

**One uptime monitor → the revenue path, not the homepage.** The single funded uptime check
should target the checkout API / event pages (where a 500 = lost money), NOT `/`. Today a Sentry
Uptime monitor hits the bare `db-health` URL (`db-health/index.ts:5`); the revenue-path check is
the higher-value target. Dashboard step: **Sentry → Insights → Uptime → the monitor → Edit URL**
to the checkout/event-page URL (or add the revenue-path monitor and demote the probe one — uptime
is $1.00/mo on PAYG, budget §6, so on the free tier keep the single monitor pointed at revenue).

**Metrics (0/5 GB) → operational counters into the Payload dashboard.** Operational counters —
outbox drains, door-scan latency, reconcile/payout job outcomes — feed the **Payload admin
dashboard** (`apps/web/src/dashboard/screens/SentryHealthScreen.tsx` + `dashboard/lib/sentry-api.ts`),
the LOCKED observability surface (budget doc "Decision LOCKED"). This is **doc-only**:
`packages/observability` has **no metrics seam today** (the `metrics` symbol re-exported by
`@sentry/react-native` 8.22.0 is the deprecated custom-metrics API — do not build on it). Route
counters to the Payload dashboard (Postgres counters + the Sentry-Health proxy), not to a Sentry
metrics API. If/when a metrics seam is added to `packages/observability`, wire it there (fix-in-library);
until then no code lands for this item.

---

## Files changed (WS-5)

| File | Change |
|---|---|
| `packages/observability/src/sampling.ts` | **new** — `dvntTracesSampler` + route→rate table + span-math proof |
| `packages/observability/src/logs.ts` | **new** — structured-logs seam (`emitLog`/`logWebhookOutcome`/`logFunnelStep`) |
| `packages/observability/src/types.ts` | `SentryStructuredLogger` type + optional `logger` on `SentrySDK` |
| `packages/observability/src/index.ts` | export sampling + logs; wire `setLogsSentry` into `initObservability` |
| `packages/observability/src/bridge.ts` | funnel bridge now emits sampled structured logs |
| `packages/observability/src/init/web.ts`, `init/expo.ts` | `enableLogs?` passthrough (default off); expo `dist = expoUpdateId ?? buildNumber` |
| `packages/observability/package.json` | `./sampling` + `./logs` subpath exports |
| `packages/observability/src/__tests__/sampling.test.ts`, `logs.test.ts` | **new** — 78 tests green |
| `apps/web/sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation-client.ts` | shared sampler, `enableLogs: true`, `dist` |
| `docs/observability-verification.md` | **new** — this doc |

**Code vs dashboard-step:** §1, §2 (seam + web enableLogs), §3 (web+mobile metadata) are code.
§2 webhook-outcome adoption (edge), §4 (CI upload step), §5 (MCP query), §6 (uptime URL, metrics)
are dashboard/CI/other-agent steps, documented precisely above.
