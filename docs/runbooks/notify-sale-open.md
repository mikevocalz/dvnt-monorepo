# Runbook — notify-sale-open

**What:** Scans events whose earliest `ticket_types.sale_start` just passed and sends one Expo push per un-notified `sale_notify_subscriptions` row, then stamps `notified_at` (no double-send). Money-tier: a missed window = silent no-shows at a ticket drop.

**Schedule:** pg_cron `notify-sale-open-every-5min`, `*/5 * * * *` → `select public.cron_notify_sale_open()` (Vault-backed dispatcher, `SALE_NOTIFY_CRON_SECRET`). Edge fn auth: `x-cron-secret`. Cron http timeout 30s.

**Idempotency:** `notified_at IS NULL` gate — already idempotent; marks after send even on partial Expo failure (avoids re-send storms).

**Lock:** `tryClaimJob("notify-sale-open", 240s)` at handler start; overlapping tick returns `{skipped, reason:"already_running"}`.

**Heartbeat / alert route:** `withHeartbeat("notify-sale-open")`. Dead-man: db-health watchdog fires ONE clamped Sentry error (`function=db-health`, message `job_heartbeats watchdog: 'notify-sale-open' overdue …`) when `now() - last_ok_at > 10m`. Auto-clears on next OK run.

**Manual re-run:**
```
curl -sS -X POST "$SUPABASE_URL/functions/v1/notify-sale-open" \
  -H "x-cron-secret: $SALE_NOTIFY_CRON_SECRET" -H "Content-Type: application/json" -d '{}'
```
Or from DB: `select public.cron_notify_sale_open();`
