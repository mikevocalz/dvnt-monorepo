# Event Editing + Promoted Events — Migration Plan

## Summary
Add co-organizer permissions, revision history, and event promotion/highlighting
to the DVNT events system. All writes go through Edge Functions (service-role gateway).
Client reads via updated SECURITY DEFINER RPCs that include `viewer_can_edit` and
`promotion_tier` in the same DTO — zero waterfall.

## Scope

### A) Co-Organizers + Permissions
- **Table: `event_organizers`** — maps users to events with role + `can_edit` flag
- Organizer (host) is auto-inserted on event creation (role='organizer')
- Co-organizers added/revoked via `/event-coorganizers` Edge Function
- Only organizer can grant `can_edit` to co-organizers

### B) Revision History
- **Table: `event_revisions`** — stores every edit as a JSON patch + summary
- Written server-side in the same transaction as the event UPDATE
- Read by organizers/co-organizers via `/event-revisions` Edge Function

### C) Event Promotions
- **Table: `event_promotions`** — tier (highlighted/promoted/sponsored), scheduling window
- Separate from existing `event_spotlight_campaigns` (which is Stripe-based paid placement)
- Promotions are lightweight organizer-initiated highlights with optional admin approval for 'sponsored'
- Active promotions surface in `get_events_home` RPC as a `promoted` section

## Schema Notes
- `events.id` is INTEGER (not UUID)
- `users.id` is INTEGER; `users.auth_id` is TEXT (Better Auth user ID)
- `events.host_id` is TEXT (stores auth_id)
- All new tables use INTEGER FKs to match existing schema
- RLS: deny-by-default for client writes; reads scoped to organizers/co-organizers

## Migration Safety Protocol
1. **01_prove.sql** — Read-only baseline queries (row counts, existing policies)
2. **02_apply.sql** — Idempotent schema changes (IF NOT EXISTS, CREATE OR REPLACE)
3. **03_verify.sql** — Post-apply verification (table existence, index checks, RLS audit)
4. **04_rollback.sql** — Safe rollback (DROP IF EXISTS, restore original RPCs)

## Risk Assessment
- **Low risk**: All additive — no existing columns dropped or renamed
- **No data migration**: New tables start empty
- **RPC changes**: Non-breaking additions (new fields in JSON output)
- **Stop conditions**: Any RLS policy allowing broad auth writes without gateway
