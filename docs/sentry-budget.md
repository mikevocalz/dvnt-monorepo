# Sentry Budget Model v2 — dvnt (org `5th-galaxy-studios`)

> **Org slug UNVERIFIED.** The Sentry token available to this repo's tooling
> resolves to org `deviant` (one project, `react-native`, **zero issues in
> 90 days**), not `5th-galaxy-studios`. Every burn figure below therefore comes
> from the 2026-08-05 ground truth recorded in the audit and could not be
> re-read at the time this doc landed. Confirm which org the mobile DSN
> (`o4511776624541696`) actually reports to before acting on §2's numbers, and
> delete this block once it is settled.

**Drop-in replacement for `docs/sentry-budget.md`.** The original's plan assumption was correct — free Developer tier throughout. What it got wrong was the **mobile source inventory**: it models one web bug and two edge-function levers, and omits the three largest mobile emitters entirely. This version rebuilds the arithmetic with them in it.

**Date:** 2026-08-24. **Plan:** free Developer — **5,000 errors · 50 replays · 1 cron monitor · 5M spans · 5 GB logs · 5 GB metrics · 100 size-analysis builds** per month. No paid plan, no PAYG (PAYG requires a paid plan). **Policy target:** every category ≤50% of reserved at steady state.

**Burn at last ground truth (2026-08-05):** errors **5,666 / 5,000 = 113%, hard-dropping**; replays 40/50 (80%); spans ~9,000 (0.18%); logs 0; metrics 0. Live users: 126 (`public.users`, 2026-08-08).

---

## 1 · What the v1 doc missed

| Source | In v1? | Why it matters on 5,000 |
|---|---|---|
| **TurboModule aggregate** — billed `level:'info'` event every 30 s, default-on since SDK 8.19.0 | ❌ absent | Alone consumes 100% of the quota at 42 session-hours/month |
| **Mobile session replay** — integration installed with no sample rates | ❌ absent (v1 covers web replay only) | Competes for a 50-replay pool already at 80% |
| **Prior-session fatal events** — one `captureMessage(level:'fatal')` per launch with full stack in `extra` | ❌ absent | Multiplies during exactly the crash loop you need headroom for |
| **App-hang cascade** — 2 s threshold + `attachViewHierarchy` walk feeding each other | ❌ absent | Unbounded, correlated with Lynk usage |
| **Profiling** — `profilesSampleRate: 0.1` armed; profiling is a billed category | ❌ absent from the table (named as billed in the baseline doc) | Allowance **UNVERIFIED** on free tier |
| **Mobile sampler drift** — mobile never adopted `dvntTracesSampler` | ❌ recorded as shipped | Not a cost issue (spans are 0.18%), but the doc's claim is wrong |

---

## 2 · Corrected budget table

| Category | Reserved | Burn 2026-08-05 | Target ≤50% | Levers (all $0) |
|---|---|---|---|---|
| **Errors** | 5,000/mo | **5,666 (113%)** | ≤2,500 | ① `enableAggregateStats: false` — §3 ② Reanimated `/` fix kills DVNT-WEB-6 (93,733 events) + siblings ③ `ignoreErrors` for DVNT-WEB-A `webkit.messageHandlers` — none exists in any config today ④ demote DVNT-EDGE-1 cdn-probe telemetry to logs ⑤ throttle prior-session fatals ⑥ break the app-hang cascade |
| **Replays** | 50/mo | 40 (80%) — 51 attached to WEB-6 alone | ≤25 | **Mobile replay integration removed.** Web keeps `replaysSessionSampleRate: 0.05` / `replaysOnErrorSampleRate: 1.0` plus `beforeErrorSampling` (verified typing: `beforeErrorSampling?: (event: ErrorEvent) => boolean` — `@sentry-internal/replay` `types/replay.d.ts:186`) so one issue cannot eat the pool |
| **Spans** | 5,000,000/mo | ~9,000 (0.18%) | ≤2.5M | `dvntTracesSampler` — live on all three web configs, **not on mobile** (§5). Not the constraint. |
| **Cron monitors** | 1 | **2 upserted from code** | 1 | cdn-probe demotes off its monitor; `db-health` keeps the single funded one; money jobs ride `job_heartbeats` dead-man rows. Unchanged from v1 — do not re-litigate. |
| **Logs** | 5 GB/mo | 0 | headroom is the point | Landing zone for demoted cdn-probe telemetry. 8.23.0 also stops ten SDK-internal warnings being written here as real records. |
| **Metrics** | 5 GB/mo | 0 | — | Same. |
| **Attachments** | small | unmeasured | — | `attachViewHierarchy: false` removes the largest contributor; slow-call breadcrumbs shrink event payloads |
| **Profiling** | **UNVERIFIED** | unmeasured | — | `profilesSampleRate: 0.1` is armed. Read the allowance off `Settings → Subscription` before deciding. |
| **Size analysis** | 100 builds/mo | 0 | — | No action. |

---

## 3 · The TurboModule arithmetic

`turboModuleContextIntegration()` is installed whenever `enableNative` is true (`@sentry/react-native@8.22.0` `dist/js/integrations/default.js`). Defaults: `enableAggregateStats: true`, `aggregateFlushIntervalMs: 30000` (`turboModuleContext.js:10,42,44`). The flush emits `client.captureEvent({ message: 'TurboModule aggregate (periodic)', level: 'info', … })` (`turboModuleContextFlush.js:66-68`) — a non-transaction event, **billed as an error**.

Two per minute = **120 per hour of active session, per session.** Lazily re-armed on first record and only fires with data in the window (`turboModuleContext.js:78-95`) — so 120/hr is the active-use rate, and on a WebRTC + camera app active use is the normal case.

| Scenario | Session-hours/mo | Events | % of 5,000 |
|---|---|---|---|
| Quota ceiling | **41.7 h** | 5,000 | 100% |
| 126 users × 20 min | 42 h | 5,040 | **101%** |
| 126 users × 1 h | 126 h | 15,120 | 302% |
| 126 users × 3 h | 378 h | 45,360 | 907% |

**Twenty minutes per user per month consumes the entire error budget on telemetry nobody asked for.** Fix: one option. `turboModuleContextIntegration({ enableAggregateStats: false, slowCallThresholdMs: 0 })`.

---

## 4 · Corrections to v1 that change its reasoning

**§3 environment audit — the mobile row's reasoning is wrong.** v1 cites `enableInExpoDevelopment: false` (`packages/observability/src/init/expo.ts:111`) as part of the mobile dev gate. That option **does not exist** in `@sentry/react-native@8.22.0` — zero occurrences across `dist/` and `src/`. The gate that actually works is `enabled: !__DEV__` (`packages/app/lib/sentry-boot.native.ts:33`). The conclusion ("mobile is already compliant") survives; the stated reason does not, and the same is true of `enableHermes: true`, which is also nonexistent — Hermes profiling is armed by `profilesSampleRate` being a number.

**§4 — the shared sampler is web-only.** v1 records `dvntTracesSampler` as shipped and "imported by all three `apps/web` Sentry configs." True, and that is the whole call-site list: `instrumentation-client.ts:56`, `sentry.edge.config.ts:20`, `sentry.server.config.ts:24`. **Mobile has zero call sites** and still runs the inline sampler at `sentry-boot.native.ts:47-51`, which lacks the chatty→0 bucket and the Sneaky Lynk → 1.0 boost. The span-math proof holds; the coverage claim does not.

**§1 replays row — extend to mobile.** v1 treats replay as a web-only problem. `sentry-boot.native.ts` pushes `mobileReplayIntegration()` with no rates set, bypassing the SDK's own gate. Decision: **removed.** There is no mobile replay budget to draw on.

---

## 5 · Post-fix model

With all six error levers landed, the sources that currently produce >100,000 events/month go to approximately zero, and the 5,000-error quota is spent on **actual errors** rather than competing with telemetry. Replays fall to web-only against a 50-replay pool with a per-error filter. Spans stay at 0.18% of 5M. Logs and metrics absorb the demoted telemetry inside a 5 GB allowance sitting at zero.

The residual risk is unchanged from v1 and is structural: **per-DSN minute-based rate limits are Business-plan only.** On the free tier there is no ceiling backstop, so the next animation-frame-frequency bug blinds the org mid-month regardless of how well the sources are tuned. The source-side fixes are not defence-in-depth — they are the entire defence. Spend/usage notifications at 50% and 80% (`Settings → Subscription → Manage Spend Notifications`, Owner/Billing role) are the only early warning, and they cost nothing.

---

## 6 · The lever that changes the ceiling

A **sponsored account** carries 5M errors, 1B spans, 100K replays, 500 cron monitors, 25 uptime monitors and 10 GB attachments per month — a thousand times the free error quota, and it would retire the cron-monitor constraint that forced the dead-man-row design.

Criteria are open-source, non-profit, or student/teacher; the open-source page asks for a friendly licence such as Apache or MIT. `dvnt-monorepo` is public and ships an MIT `LICENSE`, but its copyright line names a third party — inherited from the starter template this repo was forked from. Resolve the licence and the holder before applying. Granted at Sentry's discretion.

- <https://sentry.io/for/good> · <https://sentry.io/sponsorship> · <https://sentry.io/for/open-source/>
- Criteria: <https://sentry.zendesk.com/hc/en-us/articles/23988131745051-Do-I-qualify-for-a-Sponsored-account>
- Startup discount (no licence question; requires only being new to *paying* for Sentry): <https://sentry.zendesk.com/hc/en-us/articles/25290106838811-Do-you-offer-a-discount-to-Startups>

This does not replace §2. A thousand times the quota still hard-drops on a per-frame bug, and none of it touches the crash loop.

---

## 7 · One-line summary

Turn off the integration that bills you every thirty seconds, delete a replay integration with no budget behind it, fix the one web bug that is eighteen times the monthly quota, stop paying error quota for probe telemetry, and the free tier runs comfortably under 50% — then apply for sponsorship so the ceiling stops being the design constraint.
