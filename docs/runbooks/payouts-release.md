# Runbook — payouts-release

**What:** Finds events where `now() >= payout_release_at` and `payout_status='pending'`, claims each (CAS), holds on active disputes, nets promoter cuts out via `settlePromoters` (own connected accounts, held if unconnected), computes organizer net, creates the Stripe transfer, records the payout, and emails the statement. Money-tier — moves real money.

**Schedule:** Documented "hourly" in the fn header — **NOT present in live `cron.job`** (unverified cadence; external scheduler/manual today). Edge fn auth: `x-cron-secret` (`CRON_SECRET`).

**Idempotency:** Event claim CAS (`.eq("payout_status","pending")`) + deterministic Stripe `Idempotency-Key` per `(event, [promoter,] window)`. Ledger rows stamped `paid_out_at`. Already idempotent — a re-run or mid-run crash never double-transfers.

**Lock:** `tryClaimJob("payouts-release", 900s)` — overlap returns `{skipped}`. CAS + Idempotency-Key are the real guards; lock only stops overlap.

**Heartbeat / alert route:** `withHeartbeat("payouts-release")`. Dead-man: db-health watchdog fires ONE clamped Sentry error when `now() - last_ok_at > 90m` (60m interval + 30m margin). Absent row is NOT alerted.

**Manual re-run:**
```
curl -sS -X POST "$SUPABASE_URL/functions/v1/payouts-release" \
  -H "x-cron-secret: $CRON_SECRET"
```
