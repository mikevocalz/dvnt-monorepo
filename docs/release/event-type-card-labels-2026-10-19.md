# Event type and paid-card repair

## Single source of truth

The repository schema already defines events.event_type as the canonical TEXT
field and events.category as the legacy category enum. Discovery/detail RPCs
must return the canonical field alongside the legacy fallback.

The final implementation uses event_type as authoritative and category only as
legacy fallback. NO enum expansion, column creation, or data backfill is required.
An earlier offline enum-expansion proposal was superseded after schema inspection.

Create writes canonical event_type without attempting invalid legacy enum values.
Edit writes event_type, and an explicit legacy selection clears stale event_type.
Read adapters and success-cache hydration prefer event_type; existing typed data
is preserved. Legacy event category options remain available during editing.
Realtime patches, duplicate drafts, normalized entities and event tiles also
respect the authoritative field. Legacy broad-category duplicates require an
explicit canonical selection instead of inventing a type.
All event cards render friendly labels. Native filters use canonical identifiers.
Paid web cards show prices in the action area; free cards retain RSVP and ended
cards retain Ended. Purchase, RSVP authorization and ticket inventory are unchanged.

## Migration and release order

1. Privately capture the target RPC definitions for rollback and review migration tests.
2. Apply 20261019050000_event_type_taxonomy.sql in an authorized release. It only
   patches RPC projections, category predicates, and category affinity to use the
   existing event_type. It does NOT change event rows, enum values, auth checks,
   signatures, ownership, security mode, search_path, grants, or pagination.
3. Verify RPC metadata and migration behavior, then deploy create-event,
   bootstrap-events, event-drafts, and live-surface from this commit. Deploy the matching web client after CI.
4. Run authenticated create/edit/reload acceptance with disposable test data.

The migration guards its expected replacements and preserves the remaining live
function definitions. Rollback restores the captured old function definitions;
new event_type values remain stored and must not be erased on rollback.

Existing Other records without a canonical type cannot automatically recover their
original selection. Organizers must correct them through the editor; never guess
historical types from names or flyers. Existing canonical values are preserved.

## Verification

- App/UI/handler Node suites passed (1,392 tests).
- Actual API-method fixtures cover create/edit/detail and Past/My/Host/Liked
  reloads, rejected saves, legacy fallback and stale canonical-type clearing.
- Actual bootstrap formatter and React card markup are tested directly.
- Full web TypeScript and release-regression contract passed after schema revision.
- Combined app check has seven existing crash-delivery.test.ts Node typing errors;
  focused boundary lint has four existing zone/publication restricted imports.
- CI runs actual markup/selector interaction in Chromium and public repository-definition
  migration/rollback tests in disposable PostgreSQL (PGlite), not production.
- Local Chromium is unavailable: restricted socket startup fails, and the normal
  escalation path fails during environment bootstrap. Do not bypass that boundary.

This document is not evidence of deployment. Track the actual migration, function,
web deployment and CI outcomes separately before claiming the fix is live.
