# DM reaction release checklist

This change does not grant release approval. Keep it draft until reviewed.

## Required database contract

`react-message` requires the existing migration
`apps/mobile/supabase/migrations/20260905123000_atomic_message_reactions.sql`.
The handler intentionally fails closed when its atomic RPC is unavailable; it
must not fall back to client-side JSON writes or broaden table policies.

Before any release, run `scripts/verify-dm-reactions-readiness.sql` against the
explicitly approved target. All four results must be true. If the migration is
missing, obtain approval for **only that existing migration**, apply it through
the migration workflow, and verify the signature, service-only execute grants,
migration history and `messages` realtime publication. Do not apply unrelated
pending migrations. No data backfill is needed.

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
