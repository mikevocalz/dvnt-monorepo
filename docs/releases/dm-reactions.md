# DM reaction release checklist

This change does not grant release approval. Keep it draft until reviewed.

## Required database contract

`react-message` requires the existing migration
`apps/mobile/supabase/migrations/20260905123000_atomic_message_reactions.sql`.
The handler intentionally fails closed when its atomic RPC is unavailable; it
must not fall back to client-side JSON writes or broaden table policies.

Before any release, run `scripts/verify-dm-reactions-readiness.sql` against the
explicitly approved target. All four results must be true. If the migration is
not recognized, inspect the recorded name, statements and RPC before concluding
it is missing. If it is genuinely missing, obtain approval for **only that
existing migration**, apply it through the migration workflow, and verify the
signature, service-only execute grants,
migration history and `messages` realtime publication. Do not apply unrelated
pending migrations. No data backfill is needed.

### Migration history identity

The approved migration workflow recorded this SQL as
`20261030131710_atomic_message_reactions`; it did not create the original
`20260905123000` version row. The readiness query recognizes either version only
when the name is exactly `atomic_message_reactions` and `statements` contains
exactly one entry whose UTF-8 bytes have SHA-256:

```text
29f17beae2f230a3f2986a88a990589e03d856c90d3ed318d7bee91d3ab25aa2
```

This is the hash of the complete reviewed migration file, including comments
and whitespace. A matching name or version alone is not sufficient. Missing,
split, edited or otherwise unrecognized stored statements fail closed and need
read-only review; a failed check is not an instruction to reapply the migration.
Do not manually insert, rename or repair ledger rows to make the check pass.
This check recognizes the reviewed history; the separate RPC, execute-grant and
realtime checks remain required and do not prove live reaction delivery.

## Client changes

- Both chat screens consume scoped message UPDATE events for reaction changes.
- Own-message updates are included: a recipient can react to the sender's row.
- Desired-state writes serialize per message and session; canonical responses,
  pending optimistic intent and realtime updates reconcile without replacing
  unrelated content. Failures roll back locally and show retry feedback.
- Invalid/temporary IDs and stale account/session completions are ignored.
- Web double-tap no longer bubbles into a destructive Unsend prompt.
- Shared post, story and event bubbles expose the reaction picker while retaining
  ordinary tap navigation.

The client requires the normal web release and native app/update release; a
web deployment alone does not update an installed native client. The Edge code
change adds only privacy-preserving RPC error codes to diagnostics.

## Verification

`npm run test:dm-reactions` runs isolated API/Edge boundaries, the real shared
store, actual web input handlers and web/native realtime callbacks, plus the
existing migration in disposable embedded PostgreSQL. Use the pinned test
packages and command in `.github/workflows/dm-reactions.yml`.

These tests do not contact production, create DMs, submit reactions, prove live
Supabase transport delivery, or replace browser/device end-to-end QA. Full app
lint/typecheck/build still require the complete monorepo dependencies.

After separately approved release, repeat the read-only readiness query and
check redacted error-code aggregates. Two-account add/remove/reload and live
recipient checks require designated test accounts and explicit test-message
scope; do not use personal DMs. A delayed older realtime event is not ordered
against HTTP acknowledgements by a server revision in the existing contract;
server-backed reload remains authoritative after reconnect.
