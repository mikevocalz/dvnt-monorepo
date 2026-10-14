# Guest API boundary fixes

This patch is separate from the embedded checkout routing change. All evidence
uses synthetic local handler/database fixtures. No production database, Stripe,
email service, migration or deployment was contacted or changed.

## Confirmed defects

1. `guest-checkout` uses service-role reads and previously trusted event-page
   eligibility. Public draft, suspended, `canceled`, ticketing-disabled and SPICY
   event fixtures could quote and start a mocked checkout. The endpoint now
   requires active ticketing, rejects SPICY, and recognizes both cancellation
   spellings before creating new purchases or returning a quote. Existing private,
   hidden, future-publication and sales-cutoff checks remain in place. A legacy
   nullable `nsfw` value remains non-SPICY, matching widget eligibility.
2. `get_event_detail` returned the newest three comments with author identifiers,
   handles and avatars to anonymous callers. The UI describes these comments as
   members-only but merely blurs them. Direct `event_comments` SELECT was also
   public, limited only by the event's visibility. The new helper derives a
   signed-in profile from the JWT and existing `viewer_user_id()`, and requires
   existing `can_view_event()` permission. The RPC and a restrictive SELECT
   policy use that same helper. Reviews remain public. No anonymous-executable
   backup RPC is introduced, and no INSERT/adult-verification policy is changed.

This is member-only comment exposure on publicly accessible events; the
private-event control correctly refused anonymous access before this patch.
Reading a public discussion does not require adult identity verification under
existing product semantics. The patch does not broaden any read or write grant.
The SELECT policy also governs row visibility for realtime subscribers; it does
not change publication configuration or replica identity.

## Validation

- `NODE_PATH=<existing typescript node_modules> node --test apps/mobile/supabase/functions/guest-checkout/access.test.cjs apps/mobile/supabase/functions/guest-checkout/discounts.test.cjs`
- `node scripts/test-guest-comment-boundary.cjs --sql | psql -X -v ON_ERROR_STOP=1 -d <disposable-test-db>`
- Alternatively install `@electric-sql/pglite@0.3.14` into an isolated temporary
  directory and run the SQL test with that directory's `node_modules` on
  `NODE_PATH`. PGlite is a fixture tool, not a production dependency.

The handler fixture honors selected columns, so omitting `nsfw` from the real
SELECT cannot accidentally pass. It tests direct quote/payment/free-order
attempts and a valid quote followed by an eligibility change. Existing completed
free-order idempotency replay intentionally remains recoverable after an event
is hidden/cancelled: it does not mint another ticket or start another payment.
Its pre-existing zero-value promoter-attribution repair remains unchanged.

The SQL fixture executes the actual former function definitions to reproduce the
leak, then applies the actual new migration. It tests anonymous spoofed viewer
IDs, anonymous subjects, authenticated roles without subjects, empty subjects,
unknown profiles, ordinary members, hosts, invitees, co-organizers, ticket
holders, service role, private and hidden events. It also asserts that public
reviews and the pre-existing participation INSERT policy remain unchanged. A
source assertion restricts the RPC redefinition to the single comment join.
The fixture and access tests run in the dedicated/updated CI workflows.

## Release order and remaining verification

Keep the public-route rollout blocked until the server-side protections are
applied and separately verified by an authorized operator:

1. Compare the live `get_event_detail` definition with the migration's repository
   baseline. If it has drifted, rebase the single comment-join change on the live
   definition before applying it; do not discard newer fields or access checks.
2. Apply `20261013220000_event_comments_member_boundary.sql` through the normal
   migration process. Its helper, restrictive SELECT policy and RPC change are
   atomic. Verify anonymous RPC responses contain no comments and direct table
   reads contain no comment rows, while legitimate signed-in reads still work.
3. Deploy the corrected `guest-checkout` function and verify invalid event
   eligibility stops before any new order/payment, using approved non-payment
   checks. Keep all existing verification and age restrictions enabled.
4. Only then release the separate public-route change.

No live migration or deployment is included in this patch's authorization.
