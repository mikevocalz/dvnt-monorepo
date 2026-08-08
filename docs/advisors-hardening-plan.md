# Advisors Hardening Plan — SECURITY DEFINER exposure + search_path

**Source:** `supabase db advisors --linked --type security` run 2026-08-08 (post events+modernization release): 31 WARNs, 0 ERRORs — 29 "SECURITY DEFINER function executable via RPC" findings across 17 distinct functions (13 anon-callable) + 2 mutable `search_path`.

**Why this is a plan, not a migration:** revoking EXECUTE from the wrong function breaks the guest web surface exactly the way the 2026-08-08 `verify_jwt` outage did — `get_event_detail` is *by design* the anon API for public event pages (proved live during the incident). And per the same day's other lesson, destructive/permission DML does not go in a timestamped migration file that a later ledger push replays blind. Apply the SQL below interactively (`psql`), verify each surface after each statement, then record as a migration marked already-applied.

## Verdicts (client_rpc_refs = grep of `rpc('name'` / `rpc/name` across apps+packages, 2026-08-08)

**KEEP grants — these are the intended anon/authed API surface (each must keep enforcing its own internal checks):**

| Function | Refs | Role |
|---|---|---|
| `get_event_detail` | 2 | public event page (anon by design) |
| `get_events_home`, `get_events_for_you` | 2 each | event feeds |
| `get_event_organizer`, `get_event_campaigns`, `get_promoted_event_ids`, `get_spotlight_feed` | 1 each | event/promotion reads |
| `get_verification_status` | 2 | Didit gate reads |
| `issue_guest_rsvp_tickets` | 1 | guest RSVP path — anon required |
| `expire_spotlight_campaigns` | 1 | expire-on-read sweep (`packages/app/lib/api/promotions.ts:42`); consider moving to pg_cron later, keep grant until then |

**REVOKE anon+authenticated EXECUTE — zero references anywhere in app, edge-fn, or migration SQL:**

| Function | Nature |
|---|---|
| `enforce_event_owner_write` | trigger fn — never legitimately RPC'd |
| `set_membership_subs_updated_at` | trigger fn |
| `is_valid_event_tz` | CHECK helper |
| `recompute_event_total_attendees` | maintenance helper |
| `viewer_can_see_nsfw` | SQL-embedded helper |
| `get_event_attendee_avatars` | no reference found — re-verify for dynamic call sites at apply time |
| `get_guest_ticket_view` | no reference found — re-verify (name suggests guest ticket page; grep found nothing) |

**Pin search_path (both are triggers; behavioral risk ≈ zero, but apply one at a time):**
`set_membership_subs_updated_at`, `is_valid_event_tz`

## Prepared SQL (run interactively, one block at a time, verify between)

```sql
-- 1. search_path pins (safe)
ALTER FUNCTION public.set_membership_subs_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.is_valid_event_tz(text) SET search_path = public, pg_temp;  -- confirm signature via \df first

-- 2. revokes — AFTER re-grepping each name for dynamic call sites
REVOKE EXECUTE ON FUNCTION public.enforce_event_owner_write() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_membership_subs_updated_at() FROM anon, authenticated;
-- …confirm exact signatures with \df public.<name> before each REVOKE;
-- one function per statement, smoke the guest event page + feeds after each.
```

**Post-apply:** re-run `supabase db advisors --linked --type security --level warn`; expect the 29 DEFINER findings to drop to the KEEP list only (~20), and both search_path WARNs to clear. Then record the applied SQL as a ledger-reconciled migration.
