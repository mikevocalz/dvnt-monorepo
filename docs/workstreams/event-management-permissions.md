# Event-management permission contract

This is a source and regression-test contract, not evidence that a production rollout has occurred.

## Capabilities

- Owner, accepted admin and accepted editor: edit event content/flyers/schedule, ticket and add-on catalogs; create promo codes; access the full organizer roster; manage event Lynk setup.
- Owner and accepted admin: manage staff except admin grants/revocations; revoke promo codes; manage promoters; view event analytics; change follow-up settings.
- Owner only: admin grants/revocations, refunds, event cancellation (including resumed refund sweeps), deletion, duplication, payouts and ownership controls.
- Accepted scanner: scanning/door tools and the server's redacted roster only.
- Pending, removed, unrelated, signed-out and unknown roles: no management capability. Public ticket browsing uses an explicit safe projection without unlock codes.

Server authorization and row policies remain authoritative on each mutation. Client gates prevent misleading controls and stale/cross-account data, rather than granting permissions themselves. Fresh checks precede sensitive client actions. Editors cancel stale work when their account/session/event changes.

## Save reliability

Editors wait for event and catalog writes before reporting success. Partial catalog failures keep the form open; all pending sibling writes settle before retry is enabled. Confirmed tier, add-on and variant IDs are retained so retries update instead of creating duplicates. Uncertain transport outcomes require reopening and checking persisted rows before another save.

Native and web editors both support existing add-on catalog editing. Catalog load failures do not masquerade as empty catalogs. Add-on writes verify affected rows and parent scope. Sold/held counters and existing parent identity are protected from direct cohost writes, including fields added in future schemas. Add-ons may only require tiers belonging to their own event. Trusted inventory functions and existing owner authority are preserved.

## Continuous verification

`test:cohost-editing` runs the SQL permission suites, executed Edge handlers, API/save helpers, and mounted web/native editor, promo, organizer, staff, promoter and analytics cases. The cohost workflow runs for every pull request, master/main push and manual dispatch. The release regression gate also executes the aggregate; its manifest verifies the tests exist and run in CI.

SQL tests use disposable PostgreSQL with the relevant real schema/migration sources and fixture identities. Edge tests execute the real handler with mocked authentication/database transports. Mounted native cases render React Native source through DOM adapters. This is not device-runtime or production-account verification. GitHub required-check/branch-protection settings are not changed by this PR.

## Approved rollout checklist

1. Review and apply the source migrations `20261111120000_accepted_cohost_event_editing.sql`, `20261111121000_ticket_catalog_private_management.sql`, and `20261111140000_guard_cohost_addon_catalog.sql` through the normal migration process.
2. Deploy `notify-event-change`, `manage-promo-code`, and `event-cancel`, then release updated web/native clients. Coordinate the private ticket-read boundary with client rollout; older direct-table buyer reads must not remain in use.
3. On staging with synthetic accounts, verify owner/admin/editor content, flyer, ticket-price, add-on and promo persistence after reload. Verify scanner, pending, removed and unrelated denials, including direct API calls and revocation during a save.
4. Verify public buyer catalog/checkout, unlock-code secrecy, inventory/holds/refunds and historical order references. Verify native device media selection and upload interruption, not only DOM adapters.
5. Verify owner-only financial/destructive actions and admin-grant/revoke restrictions. Monitor permission and save failures during rollout.

No production event prices, promo codes, migrations, deployments or merges are part of this draft's implementation work.
