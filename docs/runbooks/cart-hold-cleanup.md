# Runbook — cart-hold-cleanup

**What:** Releases expired ticket holds (`cart_holds.released=false AND expires_at<=now()`) so inventory returns to sale, and abandons stale carts. Pure SQL: `public.cart_release_expired_holds()`. Money-tier: unreleased holds strand inventory during an on-sale.

**Schedule:** pg_cron `cart-hold-cleanup`, `*/5 * * * *` → `select public.cron_cart_release_expired_holds()` (wrapper: advisory lock + jitter + heartbeat around the pure sweep). Re-declared in `20260809100100_cart_hold_cleanup_reschedule.sql` after being scheduled-but-not-live (drift).

**Idempotency:** `UPDATE ... WHERE released=false AND expires_at<=now()` — inherently idempotent.

**Lock:** `pg_try_advisory_xact_lock(hashtext('cart-hold-cleanup'))` in the wrapper; overlapping tick returns immediately. Plus 0–5s jitter to de-sync from the other `*/5` jobs.

**Heartbeat / alert route:** wrapper calls `record_job_heartbeat('cart-hold-cleanup', ...)`. Errors are swallowed so the error heartbeat commits (a re-raise would roll it back). Dead-man: db-health watchdog fires ONE clamped Sentry error when `now() - last_ok_at > 10m` (5m interval + 5m margin).

**Manual re-run:**
```
select public.cron_cart_release_expired_holds();   -- with heartbeat/lock
select public.cart_release_expired_holds();          -- raw sweep, no bookkeeping
```
