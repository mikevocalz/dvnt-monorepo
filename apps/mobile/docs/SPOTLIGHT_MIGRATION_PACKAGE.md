# Event Spotlight Campaigns — Migration + Hardening Package

## 1) Executive Summary

**Change**: New `event_spotlight_campaigns` table + flyer columns on `events` + 4 RPCs + 3 Edge Functions for paid event promotion.

**Risk Level**: HIGH — payment data (Stripe), authorization logic, new sensitive table.

**Blast Radius**:

- 1 new table: `event_spotlight_campaigns`
- 2 new columns on `events`: `flyer_image_url`, `flyer_image_meta`
- 4 new RPCs: `get_spotlight_feed`, `get_promoted_event_ids`, `get_event_campaigns`, `expire_spotlight_campaigns`
- 1 trigger: `trg_spotlight_campaign_updated`
- 3 Edge Functions: `promotion-checkout`, `promotion-webhook`, `promotion-cancel`
- Client API: `lib/api/promotions.ts`

**Architecture**: Option A — Service-Role Gateway. Table is deny-by-default for `anon`/`authenticated`. All writes go through Edge Functions (service_role). Controlled reads via SECURITY DEFINER RPCs only.

---

## 2) Inventory — Impacted Artifacts

| Artifact                          | Impact                                     |
| --------------------------------- | ------------------------------------------ |
| `events` table                    | 2 nullable columns added (expand-only)     |
| `event_spotlight_campaigns` table | NEW — full schema                          |
| `cities` table                    | FK target (deferred — may not exist yet)   |
| `users` table                     | Joined in RPCs via `auth_id`               |
| `media` table                     | Joined in RPCs via `avatar_id`             |
| RLS policies                      | 8 deny policies (4 anon + 4 authenticated) |
| RPCs                              | 4 new SECURITY DEFINER functions           |
| Triggers                          | 1 new `updated_at` auto-update trigger     |
| Indexes                           | 4 new (1 partial, 1 unique partial)        |
| Edge Functions                    | 3 new (checkout, webhook, cancel)          |

---

## 3) Findings (ranked severity)

| #   | Severity  | Finding                                                     | Status                           |
| --- | --------- | ----------------------------------------------------------- | -------------------------------- |
| F1  | **SEV-0** | RLS had permissive policies letting anon/auth direct access | **FIXED** — deny-by-default      |
| F2  | **SEV-0** | `cancelCampaign()` did direct `supabase.from().update()`    | **FIXED** — now uses gateway     |
| F3  | **SEV-0** | `promotion-checkout` continued on auth failure              | **FIXED** — hard reject          |
| F4  | **SEV-1** | FK to `cities` referenced table not yet created             | **FIXED** — deferred DO $$ block |
| F5  | **SEV-1** | `get_event_campaigns` accepted arbitrary organizer_id       | **FIXED** — JWT verification     |
| F6  | **SEV-2** | Webhook skipped sig verification without secret             | **FIXED** — fail-closed in prod  |
| F7  | **SEV-3** | Unused `STRIPE_SECRET_KEY` import in webhook                | **FIXED** — removed              |
| F8  | **SEV-1** | Deferred FK never fires (20260302 runs before 20260303)     | **FIXED** — FK added to 20260303 |

---

## 4) Remediation Plan (phased steps)

### Phase 1: EXPAND (this migration)

- Add nullable `flyer_image_url`, `flyer_image_meta` to `events`
- Create `event_spotlight_campaigns` table
- Create indexes
- Deferred FK to `cities` (safe if cities doesn't exist)

### Phase 2: HARDEN (same migration)

- Enable RLS on new table
- Revoke all grants from `anon`/`authenticated`
- Create 8 explicit deny policies
- Drop any pre-existing permissive policies

### Phase 3: FUNCTIONS (same migration)

- Create 4 SECURITY DEFINER RPCs with `SET search_path = public`
- JWT verification in `get_event_campaigns`
- Grant EXECUTE only (no table grants)

### Phase 4: GATEWAY (Edge Functions)

- `promotion-checkout`: session verification mandatory, no fallback
- `promotion-webhook`: fail-closed without webhook secret in prod
- `promotion-cancel`: NEW — replaces direct client table write

### Phase 5: VERIFY

- Run `scripts/verify-spotlight-migration.sql` — all 13 gates must pass
- Run TypeScript compilation check

### Phase 6: MONITOR

- Watch error rates on promotion-checkout/webhook/cancel
- Watch p95 latency on get_spotlight_feed RPC
- Watch for RLS violation errors in Supabase logs

---

## 5) Migration Package

### 5.1 Forward SQL

File: `supabase/migrations/20260302_event_spotlight_campaigns.sql`

### 5.2 Backfill SQL

**None required** — new table, no legacy data. Flyer columns are nullable with no NOT NULL constraint.

### 5.3 Cutover steps

**None required** — expand-only migration. No existing queries or flows are modified.

### 5.4 Contract step (future)

- After cities table is confirmed present (20260303 applied), verify FK `fk_spotlight_city` exists
- If not, run the deferred DO $$ block manually

### 5.5 Rollback SQL

File: `supabase/migrations/20260302_event_spotlight_campaigns_rollback.sql`

Steps:

1. Drop functions (CASCADE drops triggers/grants)
2. Drop table (CASCADE drops indexes, constraints, policies)
3. Remove flyer columns from events
4. Verify clean state

---

## 6) Verification Suite

File: `scripts/verify-spotlight-migration.sql`

13 gates covering:

- **A**: Schema invariants (columns/types/nullability)
- **B**: RLS enabled
- **C**: Deny policies exist (8 total)
- **D**: No table grants for client roles
- **E**: Client role SELECT blocked
- **F**: Client role INSERT blocked
- **G**: SECURITY DEFINER RPCs work from client roles
- **H**: get_event_campaigns enforces JWT
- **I**: service_role has full access
- **J**: All indexes exist
- **K**: Trigger exists
- **L**: CHECK constraints exist
- **M**: No orphan data

---

## 7) Performance Plan

### Indexes

| Index                        | Covers                                         | Type                              |
| ---------------------------- | ---------------------------------------------- | --------------------------------- |
| `idx_spotlight_active_city`  | Spotlight feed query (city + placement + time) | Partial (WHERE status = 'active') |
| `idx_spotlight_by_event`     | Organizer campaign lookup                      | Composite (event_id, status)      |
| `idx_spotlight_by_organizer` | Dashboard / campaign list                      | Single column                     |
| `idx_spotlight_stripe_pi`    | Webhook idempotency check                      | Unique partial                    |

### EXPLAIN Guidance

```sql
-- Spotlight feed (hot path — called on every Events tab load)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM get_spotlight_feed(NULL);
-- Acceptance: Index Scan on idx_spotlight_active_city, no Seq Scan
-- Target: < 5ms for < 1000 campaigns

-- Promoted event IDs (hot path — called alongside feed)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM get_promoted_event_ids(NULL);
-- Acceptance: Index Scan, no Seq Scan
-- Target: < 3ms for < 1000 campaigns

-- Campaign expiry (cron — runs every 5 min)
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM event_spotlight_campaigns WHERE status = 'active' AND ends_at < now();
-- Acceptance: idx_spotlight_active_city partial index used
```

### Hot-Path Impact Assessment

- **Events feed**: +1 RPC call (`get_promoted_event_ids`) per feed load. Returns Set of IDs, merged client-side. No impact on main `get_events_home` RPC.
- **Events tab**: +1 RPC call (`get_spotlight_feed`) per tab load. LIMIT 8, single round-trip.
- **Event detail**: No additional queries (promote button is UI-only until clicked).
- **No impact** on: profile, messages, notifications, stories, tickets.

---

## 8) Gateway Contract Tests

### promotion-checkout

| Test                         | Method | Expected                     |
| ---------------------------- | ------ | ---------------------------- |
| No auth header               | POST   | 401                          |
| Invalid session token        | POST   | 401                          |
| Session user ≠ organizer_id  | POST   | 403                          |
| Event not owned by organizer | POST   | 403                          |
| Missing required fields      | POST   | 400                          |
| Invalid duration             | POST   | 400                          |
| Valid request                | POST   | 200 + `{ url, campaign_id }` |

### promotion-webhook

| Test                         | Method | Expected                       |
| ---------------------------- | ------ | ------------------------------ |
| No webhook secret in prod    | POST   | 500 (fail-closed)              |
| Invalid signature            | POST   | 500 (sig mismatch)             |
| Non-promotion event type     | POST   | 200 `{ received: true }`       |
| Valid promotion completed    | POST   | 200 `{ activated: true }`      |
| Re-delivery (already active) | POST   | 200 `{ already_active: true }` |
| Missing campaign_id          | POST   | 400                            |

### promotion-cancel

| Test                         | Method | Expected                |
| ---------------------------- | ------ | ----------------------- |
| No auth header               | POST   | 401                     |
| Campaign not found           | POST   | 404                     |
| Campaign not owned by caller | POST   | 403                     |
| Campaign already expired     | POST   | 409                     |
| Valid cancel                 | POST   | 200 `{ success: true }` |

### RPC Contract Tests

| RPC                                              | Role                         | Expected                       |
| ------------------------------------------------ | ---------------------------- | ------------------------------ |
| `get_spotlight_feed(NULL)`                       | anon                         | `[]` (works, SECURITY DEFINER) |
| `get_spotlight_feed(NULL)`                       | authenticated                | `[]` (works)                   |
| `get_promoted_event_ids(NULL)`                   | anon                         | 0 rows (works)                 |
| `get_event_campaigns(1, 'x')`                    | authenticated (no JWT match) | `[]`                           |
| Direct `SELECT * FROM event_spotlight_campaigns` | authenticated                | ERROR / 0 rows                 |
| Direct `INSERT INTO event_spotlight_campaigns`   | authenticated                | ERROR                          |

---

## 9) Post-Deploy Monitoring + Rollback Triggers

### Monitoring Checklist (first 24h)

- [ ] Supabase Edge Function logs: no 500s on promotion-checkout/webhook/cancel
- [ ] Supabase DB logs: no RLS violation errors (unexpected client bypass attempts)
- [ ] Stripe dashboard: checkout sessions created successfully
- [ ] p95 latency on `get_spotlight_feed` RPC < 50ms
- [ ] DB CPU: no spike from new indexes or trigger
- [ ] Error rate on Events tab: no increase (spotlight hooks gracefully degrade)

### Rollback Triggers

| Condition                                       | Action                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Edge Function error rate > 5% for 10 min        | Disable promotion UI (feature flag)                                    |
| DB CPU spike > 80% sustained 5 min              | Investigate; if caused by new indexes, consider dropping partial index |
| RLS violation logs from unexpected client paths | **STOP THE LINE** — investigate bypass                                 |
| Stripe webhook 500s > 3 consecutive             | Check webhook secret configuration                                     |
| Any 401/403 on valid organizer flows            | Check session verification logic                                       |

### Rollback Runbook

1. **UI rollback** (fastest): Remove spotlight imports from `events.tsx` and `events/[id]/index.tsx`. Push OTA update.
2. **Edge Function rollback**: Delete functions via Supabase dashboard (promotion-checkout, promotion-webhook, promotion-cancel).
3. **DB rollback**: Run `20260302_event_spotlight_campaigns_rollback.sql` — drops table, functions, columns.
4. **Partial recovery**: If only webhook is broken, campaigns can be manually activated via service_role in Supabase dashboard.

---

## Stop-the-Line Conditions

**MUST refuse to ship if ANY of these are true:**

- ❌ Any permissive RLS policy remains on `event_spotlight_campaigns`
- ❌ Any client role has direct table grants
- ❌ `cancelCampaign` still does direct `supabase.from().update()`
- ❌ `promotion-checkout` continues execution on auth failure
- ❌ Verification suite has any failing gate
- ❌ TypeScript does not compile clean
