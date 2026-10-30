# Activity notification reliability

This follow-up is client-only. It does not deploy the held identity/privacy
proposal, alter database publication or permissions, or resend/backfill notices.

## Reproduced defects

- Activity rendered the TanStack query, but its INSERT listener refreshed only
  a separate Zustand list. A live notification could remain absent on screen.
- A socket subscription alone offered no fallback when publication or delivery
  was unavailable. Reconnect did not reconcile the rendered cache.
- A failed single-read mutation left the rendered row optimistically read.
  Invalid/partial IDs and updates matching no owned row could appear successful.
- Header unread totals and failure rollback used only the visible page rather
  than the canonical badge count.
- Initiated-transfer text kept prompting acceptance even after completion.
- History was limited to the newest 50 before category filtering, hiding older
  ticket activity behind social notifications.

## Boundaries

A missing database notification is not repaired by refreshing the UI. Historical
recovery requires an independently authorized, targeted action; no private
account identifiers or recovery SQL belong in this public change.

Foreground refresh is a bounded fallback, not a claim of guaranteed instant
socket delivery. API failures preserve prior content, and viewer-keyed cache
updates/cleanup prevent an old subscription from refreshing another account.

Tests exercise actual API/hook/store/helper code, real TanStack observers and
mounted web/native row components with synthetic data. They are not production
account actions or proof of behavior on every installed legacy build.

## History behavior

Initial reads remain 50 raw rows. An explicit Load older action fetches one
keyset page ordered by original timestamp and ID (including microseconds).
Loaded older pages are snapshots until reopening; foreground refresh replaces
the newest page and preserves requested history. A full-page influx reopens a
continuation gap, and stale page responses cannot close that gap. Append cancels
only the same viewer's outstanding head read before committing to avoid a late
head result dropping the newly loaded page. This is not unbounded polling of
all historical pages or a guarantee of live cross-device older-page edits.
