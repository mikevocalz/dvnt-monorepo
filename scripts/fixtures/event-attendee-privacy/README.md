# Offline attendee-privacy integration fixtures

These tests run the repository's real SQL RPC bodies and privacy migration in
PGlite, plus the real `bootstrap-events` handler and privacy helper in a Node VM.
Everything is synthetic. No production access, database dump, credentials,
Supabase CLI link, deployment, or network is needed to execute the tests.

## Run

With `@electric-sql/pglite` and `typescript` available to Node:

```sh
node --test scripts/test-event-attendee-privacy-sql.cjs \
  apps/mobile/supabase/functions/bootstrap-events/index.test.cjs
```

An isolated dependency directory also works without changing repository packages:

```sh
NODE_PATH=/path/to/isolated/node_modules node --test \
  scripts/test-event-attendee-privacy-sql.cjs \
  apps/mobile/supabase/functions/bootstrap-events/index.test.cjs
```

`database.cjs` extracts the latest published input definitions from committed
migrations, installs the event-type taxonomy migration, and then applies
`20261023231057_sensitive_event_attendee_privacy.sql`. It never accepts a private
snapshot. The two home overloads are both exercised; the ambiguous ten-argument
overload is copied verbatim to a fixture-only alias so PostgreSQL can invoke it.

`schema.sql` supplies only required tables, columns, authentication helpers and
baseline RLS. `seed.sql` contains invented events and identities with `.invalid`
avatar URLs. Direct read/update tests use PostgreSQL `anon`, `authenticated` and
`service_role` roles with synthetic verified JWT claims: they exercise the same
RLS and trigger boundary used by PostgREST, without claiming to run its HTTP server.

Covered boundaries include protected default/null visibility, explicit opt-in,
ordinary-event behavior, avatar/detail/page/home/For You paths, friend counts and
ranking, direct RSVP reads, own RSVP and tickets, management-only changes,
co-organizer acceptance/role, ownership bypass attempts, lifecycle transitions,
revoked attendance, migration idempotency and atomic failure on definition drift.
Dedicated counter regressions also install the latest published attendance-counter
and owner-write triggers, checking non-owner RSVP insert/update/delete, ticket
check-in/transfer/refund, guest seats, and cross-event moves.
The Edge tests assert that hidden identity rows are not fetched, verify session
identity rather than body fields, and keep authorization failures closed.
