# Runbook — reconcile-orders

**What:** Expires stale `ticket_holds`, then finds `payment_pending` orders older than `hours_back` (default 2, max 48) and reconciles each against Stripe PaymentIntent / Checkout Session status — issues missed tickets, converts holds, or marks `payment_failed`. ACH/bank sessions left `processing` (not a failure). Money-tier.

**Schedule:** Documented "every 15 minutes via cron" in the fn header — **NOT present in live `cron.job`** (unverified cadence; invoked by an external scheduler/EAS or manually today). Edge fn auth: `x-cron-secret` (`CRON_SECRET`).

**Idempotency:** Order claim is atomic CAS (`.eq("status","payment_pending")`); ticket issue is gated by an existing-tickets count on the PaymentIntent. Already idempotent.

**Lock:** `tryClaimJob("reconcile-orders", 300s)` — overlap returns `{skipped}`. Per-order CAS is the real double-issue guard.

**Heartbeat / alert route:** `withHeartbeat("reconcile-orders")`. Dead-man: db-health watchdog fires ONE clamped Sentry error when `now() - last_ok_at > 30m` (15m interval + 15m margin). Absent heartbeat row (never run since deploy) is NOT alerted.

**Manual re-run:**
```
curl -sS -X POST "$SUPABASE_URL/functions/v1/reconcile-orders" \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{"hours_back":2}'
```
