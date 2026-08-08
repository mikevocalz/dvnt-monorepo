# Observability & Scheduled Jobs — Phase 0 Baseline

**Method:** docs/inventory lanes only over `master` — live `cron.job` + `cron.job_run_details` via psql, repo migration diff, installed-SDK typings verification, Sentry docs fetched 2026-08-08. No code touched (landing-screen Reanimated fix and `packages/observability`/web Sentry configs are owned by parallel agents).
**Date:** 2026-08-08.
**Sentry ground truth:** live org `5th-galaxy-studios` snapshot 2026-08-05 (provided). A re-verification attempt via Sentry MCP on 2026-08-08 returned HTTP 403 (`search_issues`), so the 2026-08-05 numbers stand as the quota baseline.
**Status:** Phase 0 — ends with a **QUOTA DECISION BRIEF (§6)**; Mike picks from the decision menu before any spend/dashboard change.

---

## 1 · Schedule truth — live `cron.job` (queried 2026-08-08)

`select jobid, jobname, schedule, command, active from cron.job order by jobid;` against the production `DATABASE_URL` (apps/web/.env.local):

| jobid | jobname | schedule | active | command (target) |
|---|---|---|---|---|
| 1 | `notify-sale-open-every-5min` | `*/5 * * * *` | t | `net.http_post` → `/functions/v1/notify-sale-open` with `x-cron-secret` header (secret value lives only in the cron command + edge env; redacted here), 30 s timeout |
| 2 | `dvnt-db-health` | `* * * * *` | t | `net.http_get` → `/functions/v1/db-health?checkin=1`, 8 s timeout |
| 3 | `dvnt-cdn-probe` | `*/5 * * * *` | t | `net.http_get` → `/functions/v1/cdn-probe?checkin=1`, 15 s timeout |
| 4 | `dvnt-cms-sync` | `*/10 * * * *` | t | `net.http_post` → `https://dvntapp.live/payload-api/app/sync` with `x-sync-key` header (redacted), 55 s timeout |

**Runtime distribution, last 7 days** (`cron.job_run_details` joined to `cron.job`; retention window starts 2026-08-01 19:14 UTC):

| jobname | status | runs | avg s | max s |
|---|---|---|---|---|
| `dvnt-db-health` | succeeded | 10,080 | 0.01 | 0.23 |
| `dvnt-cdn-probe` | succeeded | 2,016 | 0.02 | 0.17 |
| `notify-sale-open-every-5min` | succeeded | 2,016 | 0.02 | 0.14 |
| `dvnt-cms-sync` | succeeded | 1,008 | 0.02 | 0.11 |

Zero failed rows in 7 days; counts exactly match cadence (10,080 = 7 d × 1,440/d, etc.). ⚠️ **These durations measure only the `net.http_get/post` enqueue** — pg_net is async, so `job_run_details` says nothing about whether the edge function/CMS endpoint actually succeeded. The DB-side ledger literally cannot fail unless pg_cron itself is down; end-to-end health lives (or doesn't) in Sentry check-ins per job, which is the whole point of §4/§6.

## 2 · Live vs migrations — drift diff

Every migration touching `cron.schedule` (`grep -rniE 'cron\.(schedule|unschedule)|pg_cron' apps/mobile/supabase/migrations/`):

| Migration | What it declares | Live state | Verdict |
|---|---|---|---|
| `20260722090000_a10_probe_crons.sql:4-13` | schedules `dvnt-db-health` (`* * * * *`) + `dvnt-cdn-probe` (`*/5`) | jobids 2, 3 — exact match | ✅ in sync (header says "applied 2026-07-22 via psql") |
| `20260722160000_cms_auto_sync_cron.sql:5-9` | `dvnt-cms-sync` `cron.schedule` is **commented out** — file is documentation of a psql-applied job | jobid 4 live | ⚠️ **drift-by-design risk**: a fresh DB replay of migrations will NOT recreate this job, and the real `x-sync-key` value exists only in the live `cron.job` command + Vercel env (`APP_SYNC_KEY`). A restore/branch reset silently kills CMS auto-sync. |
| `20260527192542_enable_pg_cron_for_sale_notify.sql:10` | only `CREATE EXTENSION pg_cron` — **no migration anywhere schedules `notify-sale-open-every-5min`** | jobid 1 live | ⚠️ same drift class as cms-sync: job + its `x-cron-secret` exist only in the live table. |
| `20260516150000_mixed_cart_checkout.sql:723-736` | schedules `cart-hold-cleanup` (`*/5`, `select public.cart_release_expired_holds();`) inside a pg_cron-guarded DO block | **MISSING live** — no jobid | ❌ **live drift the other direction.** The function exists (`:443`, service_role-only `:711-715`) but nothing calls it: zero grep hits in `apps/mobile/supabase/functions/` and no cron job. Live `cart_holds` is currently empty (0 rows, 0 expired-unreleased — checkout volume is near zero today), so it's latent, not bleeding — but the first real on-sale will strand holds and block inventory. |
| `20260426_event_spotlight_campaigns.sql:270-280` | `expire_spotlight_campaigns()` labeled "runs as postgres via pg_cron" (`:269`) | never scheduled | ✅ intentional pivot, not drift: `20260427_spotlight_expire_grant.sql:16` + `20260518175454_v2_db_03c_restore_spotlight_sweep.sql:12` re-granted it to `authenticated` so the client sweep (`lib/api/promotions.ts:42` per the 03c header) fires it on feed load. The `:269` comment is stale. |

**Root cause pattern:** the two psql-applied jobs (`dvnt-cms-sync`, `notify-sale-open-every-5min`) follow the "applied via psql, file is a comment" convention, which means **`cron.job` is the only source of truth for half the schedule and both shared secrets.** Recommended (Phase 1, not this doc): idempotent re-schedule migrations that read secrets from Vault/`app.settings`, so replay ≠ outage.

## 3 · Job table — cadence, purpose, tier, monitoring

| Job | Cadence | What it does (target read) | 7-day runtime | Tier | Sentry monitoring today |
|---|---|---|---|---|---|
| `notify-sale-open-every-5min` | */5 min | `notify-sale-open/index.ts:1-15`: scans events whose earliest `ticket_types.sale_start` just passed, sends Expo push to `sale_notify_subscriptions` rows with `notified_at IS NULL`, marks them sent (no double-send). Auth via `x-cron-secret`. | 2,016/2,016 ok | **money** (a missed window = silent no-shows at a ticket drop) | **NONE** — file has zero Sentry imports: no `withSentry`, no `captureCheckIn`, no `captureEdge`. A crash inside is invisible; only symptom would be user complaints. |
| `dvnt-db-health` | every min | `db-health/index.ts:1-13`: PostgREST round-trip via supabase-js (`from("cities").select` `:36`) — exercises gateway+pooler+Postgres; `?checkin=1` wraps it in a cron check-in. | 10,080/10,080 ok | probe | ✅ `captureCheckIn` in_progress→ok/error with upsert config (`:45-63`); errors via `captureEdge` (`:65`); also a Sentry Uptime monitor hits the bare URL (`:5`). |
| `dvnt-cdn-probe` | */5 min | `cdn-probe/index.ts:1-11`: fetches Bunny canary through pull zone AND storage origin, compares latency/cache-status, self-heals a missing canary (`:63-67`). | 2,016/2,016 ok | probe | ✅ `captureCheckIn` (`:60,101`); ⚠️ alert conditions are emitted as **error events** (`captureEdge` at `:88-97`) — this is issue **DVNT-EDGE-1** in the flood analysis (§5): telemetry-as-errors burns error quota. |
| `dvnt-cms-sync` | */10 min | `packages/cms/src/endpoints/appData.ts:381-388` (`appSyncEndpoint`, `POST /app/sync`): upserts app users/events/tickets into Payload CMS collections; cron presents `APP_SYNC_KEY`, super_admins can fire it via the dashboard button (`SyncFromApp.tsx:26`). | 1,008/1,008 ok | product | **NONE** — Next.js route on dvntapp.live; failures would surface only as dvnt-web server errors if they throw, and the pg_cron ledger can't see a 4xx/5xx (async pg_net, §1). |
| `cart-hold-cleanup` | */5 min **(declared, not live)** | `20260516150000:443` `cart_release_expired_holds()` — releases expired ticket holds so inventory returns to sale. | n/a — never runs | **money** | n/a — and as pure SQL it can't check in itself; monitoring would ride on whatever re-schedules it (edge wrapper or a monitor with `checkinMargin` fed by a thin edge fn). |

**Check-in inventory (verified by grep, matches prompt):** exactly two callers of `captureCheckIn` in the entire edge tree — `db-health/index.ts:45,54` and `cdn-probe/index.ts:60,101`. Both monitors are **auto-created via the upsert config** (verified §4), i.e. the org's cron-monitor consumption comes from code, not dashboard clicks. ⚠️ That's **2 monitors against a reserved quota of 1** (ground truth) — one of the two is either unbilled-pending, deactivated, or riding a state Sentry won't keep honoring; §6 makes this Mike's call rather than letting Sentry pick which dead-man's switch survives.

## 4 · SDK verification (installed source, not docs-lore)

- **`captureCheckIn` upsert semantics.** Edge functions pin `npm:@sentry/deno@10` (`_shared/sentry.ts:11`, `db-health/index.ts:14`) — a **floating major pin** that resolves to the latest 10.x at deploy (10.69.0 as of 2026-08-08). Verified against the published package: `@sentry/deno@10.69.0` `build/esm/index.d.ts:3` re-exports `captureCheckIn` from `@sentry/core`, whose installed typing is `export declare function captureCheckIn(checkIn: CheckIn, upsertMonitorConfig?: MonitorConfig): string;` — `node_modules/@sentry/core/build/types/exports.d.ts:142` (@sentry/core 10.69.0), with the docstring "Use this if you want to create a monitor automatically when sending a check in." This confirms the citation already inlined at `db-health/index.ts:19` is accurate: passing `MONITOR_CONFIG` (`db-health/index.ts:21-26`, `cdn-probe/index.ts:15-20`) upserts the monitor definition on every check-in — schedule/margin/maxRuntime in code win over dashboard edits.
- **Replay error-sampling hook (for the DVNT-WEB-6 replay flood).** The real option is **`beforeErrorSampling`** on the replay integration: `node_modules/@sentry-internal/replay/build/npm/types/types/replay.d.ts:186` — `beforeErrorSampling?: (event: ErrorEvent) => boolean;` with the typedoc (`:178-185`): "Return `true` continue sampling error, or `false` ignore error replay sampling… Use filter out groups errors should def. not be sampled." (installed `@sentry-internal/replay@10.57.0`, consumed by `@sentry/nextjs@10.69.0`). This is the surgical lever: returning `false` for the Reanimated per-frame error keeps `replaysOnErrorSampleRate: 1.0` (apps/web/src/instrumentation-client.ts:29) for everything else while stopping one issue from eating the 50-replay quota (51 replays attached to WEB-6 alone). No other invented options — `replaysSessionSampleRate`/`replaysOnErrorSampleRate` are top-level; `beforeErrorSampling` is the only per-error replay filter in the typings. Wiring it is the parallel web-config agent's change, not this doc's.
- **User Feedback billing category.** Per https://docs.sentry.io/pricing/ (fetched 2026-08-08): the billed categories are errors, spans, replays, logs, metrics, profiling, attachments, cron/uptime monitors, size analysis, Seer — **User Feedback does not appear as a billed category**, and https://docs.sentry.io/product/user-feedback/ contains no billing statements. **Explicitly unverifiable further:** whether feedback *attachments* (screenshots) draw from the 1 GB attachments quota is stated nowhere fetched; treat feedback events as free, feedback screenshots as "assume attachments quota until proven otherwise."

## 5 · Error-flood analysis (ground truth, 2026-08-05)

Quota: **errors 5,666/5,000 reserved (113% — hard-dropping)**, replays 40/50 (80%). Reserved elsewhere: 1 cron monitor, 5M spans (0.18% ≈ 9k used), 5 GB logs (0), 5 GB metrics (0), 100 size-analysis builds (0). That reserved shape (5k errors / 50 replays / 1 monitor) matches Sentry's **free Developer plan** — every §6 option prices against that.

- **Driver: DVNT-WEB-6 — 93,733 events**, Reanimated web per-frame crash on `/`, 51 replays attached, plus siblings WEB-5/D/C/2/E from the same landing-screen animation. One bug at animation-frame frequency is ~18× the entire monthly error quota; nothing else meaningfully matters until it's fixed (owned by the landing-screen agent) **and** rate-limited so the next per-frame bug can't repeat this (§6).
- **DVNT-WEB-A** — `webkit.messageHandlers` noise (iOS WebView extension junk): classic `ignoreErrors` candidate; both web configs currently ship **no `ignoreErrors` at all** (apps/web/sentry.server.config.ts:5-21, sentry.edge.config.ts:5-17, src/instrumentation-client.ts:5-32 — confirmed by read). Client-side `ignoreErrors` "instructs the SDK to never send" matching events (docs, manage-event-stream-guide, fetched 2026-08-08) — drops before quota. Config change belongs to the web-config agent.
- **DVNT-EDGE-1** — cdn-probe emitting operational telemetry as error events (`cdn-probe/index.ts:88-97`: non-200 and edge-slower-than-origin both `captureEdge`). At */5 cadence a sustained Bunny slow-patch = 288 errors/day of quota for a *condition*, not a bug. Right home: the monitor's own error status (already sent, `:101-104`) + metrics/logs (5 GB each, 0% used) for latency; keep error events only for "pull zone hard down."

## 6 · QUOTA DECISION BRIEF — stop-and-ask for Mike

Facts that price the options: free-Developer reserved shape (§5); PAYG "is only available on paid plans" and extra monitors cost **$0.78/monitor/mo**, uptime **$1.00/mo** (docs.sentry.io/pricing + /pricing/quotas/manage-cron-monitors/, fetched 2026-08-08); Team-plan error overage from **$0.00029/event reserved / $0.0003625 PAYG**; per-key rate limits are gated: **"available only if your organization is on a Business or Enterprise plan"** (manage-event-stream-guide). Money jobs from §3: **2** (`notify-sale-open-every-5min`, `cart-hold-cleanup` once resurrected).

**Option A — stay free, fix the sources ($0/mo).** Land the Reanimated fix + `ignoreErrors` (webkit noise) + `beforeErrorSampling` (replay guard) + demote cdn-probe telemetry. Errors should fall from 5,666 to plausibly <500/mo. **Cost:** $0. **Residual risk:** no per-DSN rate limit available on this plan (Business-only) and Spike Protection can't fully save a per-frame loop inside 5k/mo headroom — the next WEB-6-class bug blinds the org again mid-month. Cron monitors stay 2-upserted-vs-1-reserved: Sentry, not us, decides which dead-man's switch stays live; `notify-sale-open` and `cart-hold-cleanup` stay unmonitored.
**Option B — Team plan + small PAYG circuit-breaker (~$26–46/mo).** Team ($26/mo, 50k errors reserved) + PAYG cap of ~$20 as the circuit-breaker. 50k reserved absorbs a spike 10× today's quota; PAYG covers monitors: legitimize the 2nd probe monitor (+$0.78) and monitor **all money jobs** — check-ins added to `notify-sale-open` + resurrected `cart-hold-cleanup` = 4 monitors total = 1 included + 3 × $0.78 = **+$2.34/mo**. Spend notifications (§ budget doc) at 50/80% make the PAYG cap a tripwire, not a bill.
**Option C — Business plan (~$80/mo+):** only if the per-DSN rate limit itself is wanted as the primary defense — it's the sole plan tier where **Settings → SDK Setup → Client Keys (DSN) → Configure → minute-based rate limit** exists (recommendation for dvnt-web when available: a minute-based cap near ~10× peak legit rate, per the docs' "KEY USAGE IN THE LAST 30 DAYS" sizing guidance — dashboard step, no code). Overkill for 126 users (live `public.users` count, 2026-08-08) unless the org wants hard ceilings now.

**Decision menu (pick one per line):**
1. **Plan:** A (free + fixes only) / **B (Team + ~$20 PAYG cap — recommended)** / C (Business).
2. **Cron monitors:** keep 2 probes only / **add money jobs → 4 monitors, +$2.34/mo (recommended, requires ≥B)** / drop db-health to `*/5` and keep 1 monitor free.
3. **`cart-hold-cleanup`:** re-schedule live via idempotent migration (money-tier gap, §2) — yes/no.
4. **Schedule-as-code:** write real re-schedule migrations for the two psql-only jobs with secrets out of `cron.job` — yes/defer.
5. **DVNT-EDGE-1:** demote cdn-probe latency conditions from error events to logs/metrics — yes/no.
