# Monetization V1 Migration Plan

## Scope
Additive DDL only. No columns dropped. No existing constraints removed without replacement.

## Changes

### 1. `events.event_type` (text)
Enum of 26 categories. Default NULL (not required for existing rows).

### 2. `orders` — fee component columns
Store each fee component for receipts, reconciliation, and audit:
- `buyer_pct_fee_cents integer DEFAULT 0`
- `buyer_per_ticket_fee_cents integer DEFAULT 0`
- `buyer_fee_cents integer DEFAULT 0`
- `org_pct_fee_cents integer DEFAULT 0`
- `org_per_ticket_fee_cents integer DEFAULT 0`
- `organizer_fee_cents integer DEFAULT 0`
- `dvnt_total_fee_cents integer DEFAULT 0`
- `fee_policy_version text DEFAULT 'v1_250_1pt'`
- `quantity integer DEFAULT 1`
Update `orders.type` CHECK to include `'sneaky_subscription'`.

### 3. `promo_codes` (new table)
Organizer-created discount codes for ticket tiers.

### 4. `sneaky_subscription_plans` (new table)
Seed data: free, host_25 ($14.99/mo), host_50 ($24.99/mo).

### 5. `sneaky_subscriptions` (new table)
Per-host active subscription record synced from Stripe Billing webhooks.

## Safety Protocol
- Plan → Prove (003_verify.sql) → Apply (002_apply.sql) → Verify → Rollback (004_rollback.sql)
- All statements use IF NOT EXISTS / EXCEPTION handlers
- All new tables get RLS + service_role grants

## Rollback
See 004_rollback.sql — drops all NEW tables + new columns only.
Existing tables/columns are NOT touched in rollback.
