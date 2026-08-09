# Sentry Budget Model — dvnt (org `5th-galaxy-studios`)

**Date:** 2026-08-08. **Burn source:** live-org ground truth snapshot 2026-08-05 (MCP re-check on 2026-08-08 returned 403; see observability-baseline.md header). **Plan shape:** reserved volumes match Sentry's free Developer tier (5k errors / 50 replays / 1 cron monitor / 5M spans / 5 GB logs / 5 GB metrics / 100 size-analysis builds). Policy target: **every category ≤50% of reserved at steady state**, so a bad week fits inside the other half.

## 1 · Budget table

| Category | Reserved | Burn (2026-08-05) | Target ≤50% | Levers (owner) |
|---|---|---|---|---|
| Errors | 5,000/mo | **5,666 (113%) — hard-dropping** | ≤2,500 | ① Reanimated `/` fix kills DVNT-WEB-6 (93,733 events) + siblings WEB-5/D/C/2/E (landing-screen agent). ② `ignoreErrors` for DVNT-WEB-A `webkit.messageHandlers` — none exists today in any web config (sentry.server.config.ts:5-21, sentry.edge.config.ts:5-17, instrumentation-client.ts:5-32) (web-config agent). ③ Demote DVNT-EDGE-1 cdn-probe conditions (`cdn-probe/index.ts:88-97`) from `captureEdge` errors to logs/metrics. ④ Per-DSN minute rate limit — Business plan only (decision menu §6, baseline doc). |
| Replays | 50/mo | 40 (80%) — 51 attached to WEB-6 alone | ≤25 | `beforeErrorSampling` on `replayIntegration` filters which errors trigger replay capture — verified typing `beforeErrorSampling?: (event: ErrorEvent) => boolean;` at `node_modules/@sentry-internal/replay/build/npm/types/types/replay.d.ts:186` (web-config agent). Keep `replaysSessionSampleRate: 0.05` / `replaysOnErrorSampleRate: 1.0` (instrumentation-client.ts:28-29) — session sampling isn't the problem, error-triggered floods are. |
| Spans | 5,000,000/mo | ~9,000 (0.18%) | ≤2.5M (math: §4 lands at ~0.9M worst-case) | `tracesSampler` map (§4). Already partially live: web server/client boost onboarding/checkout/auth to 1.0, 0.15 default (sentry.server.config.ts:14-18, instrumentation-client.ts:18-22); mobile identical (packages/app/lib/sentry-boot.native.ts:47-51). |
| Cron monitors | 1 | **2 upserted from code** (`db-health/index.ts:45`, `cdn-probe/index.ts:60` — auto-create via upsert config, verified @sentry/core exports.d.ts:142) | 1 free ⇒ over already | Decision menu item 2 (baseline §6): money-job coverage = 4 monitors = +$2.34/mo PAYG at $0.78/monitor (docs.sentry.io/pricing, fetched 2026-08-08; PAYG needs a paid plan). |
| Logs | 5 GB/mo | 0 | headroom is the point | Intentional landing zone for demoted cdn-probe telemetry. |
| Metrics | 5 GB/mo | 0 | — | Same. |
| Size analysis | 100 builds/mo | 0 | — | No action. |
| User Feedback | n/a | n/a | n/a | **Not a billed category** per docs.sentry.io/pricing (fetched 2026-08-08; category absent from every pricing table). Unverified residue: whether feedback screenshots draw on the 1 GB attachments quota — stated nowhere fetched; assume yes until disproven. |

## 2 · 50/80% alert wiring — dashboard step (no code)

Sentry's **Spend Notifications** fire by default at "80% of the organization's reserved volume … has been depleted" and at full depletion, to Owner/Billing members (docs.sentry.io/product/alerts/notifications/, fetched 2026-08-08). Exactly where to wire the policy:

1. **Org thresholds:** `Settings → Subscription → Manage Spend Notifications` — customize "Subscription Consumption" percentages; **add 50% alongside the default 80%** for errors, replays, spans. If a PAYG budget exists (Option B), set "Pay-as-you-go Consumption" thresholds the same way.
2. **Delivery:** User Settings → `Notifications` → **Spend** row → cog wheel → route to email/Slack per person.

This is a dashboard action for Mike (Owner/Billing role required) — nothing in the repo can set it.

## 3 · Environment audit — what dev/preview send **today**

| Surface | Environment tag | Dev sends? | Preview sends? | Citations |
|---|---|---|---|---|
| Web client | `NEXT_PUBLIC_VERCEL_ENV \|\| NODE_ENV \|\| "development"` | **YES** — DSN has a committed fallback and there is no `enabled` gate, so `next dev` ships events tagged `development` | **YES**, tagged `preview` | instrumentation-client.ts:8-11 |
| Web server/edge | `VERCEL_ENV \|\| NODE_ENV \|\| "development"` | **YES** (same committed-fallback DSN, no gate) | **YES** | sentry.server.config.ts:8-11, sentry.edge.config.ts:8-11 |
| Mobile (document-only — config is OUT of scope to change) | `__DEV__ ? "development" : "production"` | **NO** — `enabled: !__DEV__` (sentry-boot.native.ts:33-34) plus `enableInExpoDevelopment: false` (packages/observability/src/init/expo.ts:111); the committed DSN fallback (sentry-boot.native.ts:26-29) is armed but dark in dev | ⚠️ EAS preview/TestFlight builds are release builds → they send tagged **`production`** (no channel→environment mapping; only an `updateChannel` tag, expo.ts:104) | app.config.js:280-282 wires only the build-time plugin (source-map upload), not runtime behavior |
| Edge functions | `SENTRY_ENVIRONMENT \|\| "production"` | ⚠️ local `supabase functions serve` sends tagged **`production`** unless `SENTRY_ENVIRONMENT` is set locally | n/a | `_shared/sentry.ts:24` (DSN committed fallback `:13-16`) |

**Near-zero policy (target, for the web-config agent + dashboard):** dev and preview together should account for ~0% of every quota. Web should mirror mobile's pattern — gate with `enabled` (or sample-to-zero) when environment ≠ `production`; until then, dev/preview noise competes with production for the same 5k errors. Edge functions: set `SENTRY_ENVIRONMENT=development` in local serve envs so mislabeled events are at least filterable. Mobile is already compliant.

## 4 · Span math — proposed `tracesSampler` map fits 5M with ≥3× headroom

Proposed map (extends the shipped onboarding/checkout/auth boost): **checkout, signup/onboarding, Sneaky Lynk join, media upload → 1.0; chatty routes (feed polling, presence/heartbeat, health probes) → ~0; everything else → 0.15.**

**Volume grounding (live DB, 2026-08-08):** 82 Better Auth sessions / 62 distinct users in 30 days (`public.session` where `createdAt > now()-30d`), 126 users total, 56 new users/30d, 11 posts/30d, 14 tickets/30d, 0 orders/30d. Current burn agrees: ~9k spans/mo (0.18% of 5M).

Worst-case model at **~120× today's session volume** (assumption, not a measurement: 10,000 sessions/mo — where DVNT hopes to be, not where it is):

| Bucket | Sessions/mo | Tx per session | Rate | Spans/tx | Spans/mo |
|---|---|---|---|---|---|
| High-value flows (checkout, signup, lynk join, upload) | 2,000 touch one | 3 | 1.0 | 40 | 240,000 |
| Default navigation/API | 10,000 | 20 | 0.15 | 20 | 600,000 |
| Chatty routes + probes | — | — | ~0 | — | ~0 (db-health alone would be 43k tx/mo at 1.0 — the ~0 bucket is what makes this work; edge `_shared/sentry.ts:28` currently samples probes at 0.15 ≈ 6.5k tx/mo, acceptable) |
| **Total** | | | | | **≈ 840,000 = 16.8% of 5M → 5.9× headroom** |

Even doubling every assumption (40 tx/session, 40 spans/tx) lands at ~3.4M — still under 5M — and today's *actual* traffic is two orders of magnitude below the model. Spans are not the constraint; errors and replays are.

**SHIPPED (WS-5, 2026-08-09):** this map is now a single exported `dvntTracesSampler` + route→rate table in `packages/observability/src/sampling.ts` (with this span-math proof inlined as a comment), imported by all three `apps/web` Sentry configs (server/edge/client) — replacing their inline `onboarding|welcome|verification|checkout|auth → 1.0 / 0.15` samplers. Adds the chatty→0 bucket (health probes, `.well-known`, feed-poll/presence/heartbeat) and Sneaky Lynk join + media upload → 1.0. Verified against `@sentry/core` 10.69.0: `tracesSampler` sig at `options.d.ts:585`, `TracesSamplerSamplingContext` at `samplingcontext.d.ts`. See [observability-verification.md](./observability-verification.md) §1. Logs (§1 table) turned on via `enableLogs: true` (verified `options.d.ts:530`) as the home for webhook outcomes + funnel logs — §2 of the same doc.

## 5 · One-line summary

Fix the one bug that is 18× the error quota, filter its replay capture with `beforeErrorSampling` (typings-verified), stop paying error-quota for probe telemetry, wire 50/80% spend notifications at `Settings → Subscription → Manage Spend Notifications`, and the whole org runs at <50% of the free tier — plan/monitor spend (§6 of observability-baseline.md) is then purely about resilience, not survival.

---

## Decision LOCKED (2026-08-08): free Developer tier only — no Team, no PAYG

Mike's call: **cannot afford a paid plan.** This settles the decision menu — stay on the free Developer tier; **no PAYG circuit-breaker** (PAYG requires a paid plan anyway). Consequences, all free-tier-native:

- **Money-job monitoring = dead-man rows, NOT Sentry cron monitors.** Only 1 cron monitor is reserved and `db-health` holds it. The money jobs (`reconcile-orders`, `payouts-release`, cart-hold cleanup, spotlight expiry, `notify-sale-open`) get a `job_heartbeats` table (job name → last_ok_at, last_run_at, last_status) that each job writes on success; the `db-health` probe polls it and raises ONE Sentry error (within the error budget, clamped) when any money job is overdue past its interval + margin. Zero incremental cost, no paid monitors. This is the baseline's documented fallback (§WS-3) and is now the chosen path.
- **`cdn-probe` demotes off its monitor** — its telemetry is logs/metrics + the dead-man row, freeing intent for `db-health` to stay the single funded monitor.
- **Sentry surface = the Payload admin dashboard** (`apps/web/src/dashboard/screens/SentryHealthScreen.tsx` + `dashboard/lib/sentry-api.ts`, server-proxied via `/api/observability/sentry` with the internal-integration token). Crash-free / issues / feature-health / release-health / the cron monitors already render there. The dead-man watchdog view belongs here too — extend this screen, not the hosted Sentry UI.
- **50/80% usage alerts** stay as the free-tier Spend/Usage notifications (dashboard toggle) — they cost nothing and are the early-warning the budget relies on.

The error/replay/span levers above (kill the flood, clamp, replay-gate, tracesSampler map) are what keep the free tier comfortably under 50% — they are now load-bearing, not optional. Observability WS-3/4/5 proceed in this free-tier form (dead-man rows + logs/metrics/spans on the existing free allowances), no plan change required.
