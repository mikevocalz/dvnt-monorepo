# Runbook — spotlight-expiry

**What:** Flips `event_spotlight_campaigns` rows past `ends_at` from `status='active'` to `'expired'`. Keeps the `status` column honest (the feed RPCs already filter by `now() BETWEEN starts_at AND ends_at`, so users never see expired campaigns regardless).

**Schedule:** **NOT a cron job.** Client-fired on feed load via `lib/api/promotions.ts` sweep → `public.expire_spotlight_campaigns()` (granted to `authenticated` + `service_role`). Cadence == organic feed traffic. (The `:269` "runs as postgres via pg_cron" comment in the original migration is stale — see baseline §2.)

**Idempotency:** `UPDATE ... WHERE status='active' AND ends_at<now()` — inherently idempotent.

**Lock:** `pg_try_advisory_xact_lock(hashtext('spotlight-expiry'))` — concurrent feed-load calls collapse to one sweep; the rest back off.

**Heartbeat / alert route:** the function calls `record_job_heartbeat('spotlight-expiry', ...)` on each real sweep. Dead-man: db-health watchdog uses a LENIENT SLA (60m interval + 60m margin → alert at `now() - last_ok_at > 120m`) because there is no fixed cadence — it only catches a total absence of feed traffic / a broken sweep.

**Manual re-run:**
```
select public.expire_spotlight_campaigns();
```
