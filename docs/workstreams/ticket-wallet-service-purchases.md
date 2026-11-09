# Service purchases from Tickets

## Defect

The web and native ticket-detail screens independently advertised every higher-priced ticket type as an upgrade. For a complimentary admission, that included Coat Check. The admission-upgrade destination correctly excluded services, so the advertised service disappeared after navigation. The event page's separate purchase flow already worked.

## Correction

- Share purpose-aware ticket-detail offers: admission upgrades remain admission-only; services have separate named purchase actions.
- Active and scanned holders can buy services regardless of whether admission was comp, free or paid. Scanned admission still cannot be upgraded.
- Navigate to the existing event purchase screen with an explicit service selection. No hold, payment or credential mutation starts from the URL. The original pass remains unchanged.
- Revalidate purpose, event scope, visibility, availability and per-person allowance. Missing/stale/locked service links never silently become admission purchases. Manual selection, repeated entry, Back/Forward and checkout dismissal remain explicit.

## Verification and release boundary

Synthetic full-screen mounted tests reproduce the old false upgrade on both platforms and cover the corrected Tickets entry, destination selection, account changes, late catalog responses, comp/free/paid/scanned parity and unchanged QR. Disposable PostgreSQL cases verify admission limits do not consume service allowances, and preserve service stock/caps and paid/free replay protection. Existing Chromium event-purchase coverage includes the wallet service URL and responsive comp-holder selection.

Production changes are client UI only. No backend source, migration, historical classification, payment policy, provider credentials or reporting schedule changes are required. Web release and native distribution require separate authorization; this draft does not deploy either. Native host-component tests do not replace physical-device testing.
