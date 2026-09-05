# Host Door sync evidence — 2026-09-05

`syncDoorToWatch` had no caller. The new `useWatchDoorSync` discovers the current user's owned events and accepted scanner/editor/admin assignments, selects an active event in its operational window, and publishes a generation-scoped door snapshot every 30 seconds while the phone query is active. Master/door disable and logout send an empty snapshot. Account identity is resolved from the captured viewer; account checks bracket data/token awaits. HTTP permission revocation, disappearance or inactive event clears the snapshot. Other failures send explicit error state; native stores preserve the old counts and timestamp with a retry message.

The existing `get-host-dashboard` was unsuitable as count authority: it ignores some query errors and gathers unpaginated ticket rows. The existing `get-event-tickets` roster is paginated, and its comments claimed aggregate presence support that was not implemented. Computing counts from the first 200 rows would be wrong.

Added a `summary:true` branch to the existing authorized `get-event-tickets` endpoint and additive `20260905124000_watch_door_summary.sql`. The service-only SQL function repeats owner/accepted-role authorization and derives all counts in one statement snapshot, with no row cap:

- Expected: active, scanned and transfer-pending tickets; refunded, void and abandoned excluded.
- Arrived: scanner-owned `status=scanned` or non-null `checked_in_at`, never user-reported arrival.
- Remaining: expected minus arrived.
- Priority lane: not admitted and actual live membership meets event skip-line configuration, mirroring the existing roster's rank and grace/paid-cancellation rules.
- Approaching: not admitted, unexpired opted-in approaching state for the ticket's current holder. Expired, transferred former-holder, refunded and already-scanned presence does not count.

Only event ID/title and five counts cross the watch wire. No roster, user IDs, QR credentials, coordinates, geofences or individual presence states are returned. Payload validation rejects missing, negative, fractional or inconsistent counts and strips additional fields.

Validation:

- `PATH=/opt/homebrew/opt/postgresql@14/bin:$PATH python3 apps/mobile/supabase/__tests__/watch-door-summary.integration.py`: passed actual migration on a disposable socket-only server. Covers owner/roles/pending/revoked permission, ticket states, tier grace and config, consent expiry and transfers, 5000+ completeness, concurrent committed snapshots, service-only grants, repeated migration and rollback preserving tickets.
- `deno check --no-lock apps/mobile/supabase/functions/get-event-tickets/index.ts`: exit 0.
- `node --import tsx --test packages/app/features/watch/watch-door-payload.test.ts`: passed count validation/data minimization.
- Native integration agent typechecked Door generation/error handling and is recording final linked build evidence separately.

No production migration, endpoint deployment, live guest scan or host permission mutation was executed. The new endpoint branch requires its migration before deployment. Device acceptance of host discovery, retry, permission revocation and live scan refresh remains required.
