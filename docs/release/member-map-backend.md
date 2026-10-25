# Approximate member avatar map: backend release gate

This change is staged, not deployed. It uses the existing DVNT Supabase backend.
It does not infer attendance, disclose tickets or RSVP relationships, or alter the
sensitive-event attendee policy.

## Consent and lifetime

- Overall location and Events avatar sharing default off independently of every
  legacy city/proximity preference. Each account must explicitly opt in.
- Map opt-in is versioned `events-map-v1`, lasts at most one hour, and does not
  renew merely because the app publishes a fresh position.
- Only roughly 1.1 km cell coordinates are stored or returned. Raw GPS is not
  retained by this endpoint. The client also coarsens before transmission.
- Each observation is accepted only within 60 seconds (5 seconds future clock
  skew), and disappears from reads within 15 minutes or at grant expiry.
- This is foreground approximate presence, not background live tracking.
- Both viewer and targets require verified adult public profiles and current
  grants. App/auth/moderation bans and either-direction blocks exclude members.
- Moved-cell updates use database rate limits of four per hour and twelve per day;
  same-cell foreground freshness updates retain a separate request budget.
- Events and master OFF are unconditional withdrawal RPCs, permitted even after
  verification/admission loss. They serialize with publish on the settings row.
  Revision checks prevent an old device re-publishing after withdrawal.
- Every edge action binds `expectedAuthId` to the verified session to prevent
  async account switching from mutating or publishing as another account.

## Compatibility and prerequisites

The proposed migration also prevents legacy proximity clients from writing when
the new overall switch is off or absent. The updated legacy edge function checks
both parties' masters before reading distance snapshots. Existing city labels
remain ordinary profile fields; neither old city consent nor old proximity consent
enables avatar-map sharing.

Before applying this migration, verify the existing
`20261002165000_member_proximity_presence.sql` prerequisite is installed: the new
master-off transaction and trigger reference that table. Also verify the existing
`20261015122000_member_proximity_presence_purge.sql` retention job and shared
verification, user-settings, moderation and database-rate-limiter prerequisites.
Repository files are not proof of production migration state. Do not bypass a
missing prerequisite by dropping the guard or silently changing live schema.

The new feature must stay unavailable (not optimistically enabled) until its
migration and edge functions have been released. Do not silently turn old users on.

## Release checklist (requires separate approval)

1. Run SQL and edge tests against synthetic data. Review all service-only ACLs and
   invoker functions. The sole SECURITY DEFINER exception is the service-only
   `member_map_moderation_clear(integer)` boolean helper, with fully qualified
   private-table references and `search_path=pg_catalog,pg_temp`. Its migration
   owner must be able to read `payload.members`; do not grant payload schema or
   table access to service_role. Tables have RLS with no anon/authenticated grants.
2. Verify the prerequisites above, then apply reviewed
   `20261024164346_member_map_explicit_consent.sql` to the existing backend and
   deploy `member-map`, `member-proximity` (absent in production preflight), and updated
   `places-autocomplete` together. The Places update is required so Overall OFF
   removes external IP geolocation entirely. Only explicit device/city coordinates
   can bias Places search; missing coordinates use manual/global search. Legacy
   `allowIpBias` inputs are ignored and caller IPs are never sent to an IP lookup provider.
3. Confirm service RPC/schema availability and local clients' fail-closed behavior,
   using only explicitly consenting synthetic test accounts.
4. Release clients only after the backend gate is confirmed.
5. Verify two opt-in accounts, deny permission, block in either direction, expire,
   revoke from a second device, ban and account switch. Verify Events venues still
   work with sharing off and private-event attendance never appears.
6. Check the optional `member-map-presence-purge` cron exists where pg_cron is
   available. Reads enforce expiry even if the job cannot run. Without cron,
   arrange approved deletion of expired coarse rows before production launch.

Rollback should disable the feature, not restore silent legacy sharing or expose
tables. Do not re-enable user grants from a rollback snapshot.

## Tests

Use the same pinned PGlite 0.3.10 and TypeScript tooling as CI:

```sh
NODE_PATH=<isolated-test-tools>/node_modules node --test   scripts/test-member-map-sql.cjs   apps/mobile/supabase/functions/member-map/index.test.cjs   apps/mobile/supabase/functions/member-proximity/master-location.test.cjs   scripts/test-proximity-privacy.cjs
```

SQL tests execute the actual proposed functions in PostgreSQL/PGlite against a
wholly synthetic schema, including grants/roles and mutation outcomes. This is
not a live Supabase migration, advisory scan, concurrency load test or device
acceptance.

The narrowed moderation helper is a migration revision requiring fresh release
approval; previous approval of an invoker-only migration does not cover it.
