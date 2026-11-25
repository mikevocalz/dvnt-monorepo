# DVNT coordinated web release plan (not executed)

Target: PR #305 for web and mobile web on dvntapp.live. No native build, AI, new payout worker, payout migrations, payout reminders, live charge test, or money movement. Staff-invite cleanup is in scope. New email invitations for people without an account stay off: the tested Vercel branch was private staging, and the production sender, RPC credential, tracking policy and dispatcher are not configured.

## Sequence after separate production authorization

1. Confirm the exact PR head, required checks, and Vercel web build. Confirm master and live Vercel are still 42df685edee7a2b4a6591e4d2a7c182ab8c26eb1 and dpl_FmStQvsUfGC3ZCgnizCb8ua7KuGn. Compare the active Edge deployment versions and source digests to the rehearsed bundles. Stop on a changed source or failed check.
2. Apply the six scoped Supabase migrations only: 20261124162200 (post media), 20261124212500 and 20261124213000 (guest contact and staff lookup), 20261124221500 and 20261124221600 (dormant staff email RPCs), and 20261125103000 (web member receipts). Do not replay the whole migration directory or staging-only prerequisites. Keep the global web-contact requirement off for cached web and native compatibility.
3. Install only the web-dependent Edge updates: update-post-web, get-posts, event-analytics, get-event-tickets, invite-co-organizer, guest-checkout, rsvp-issue-guest, rsvp-issue-ticket, create-payment-intent, cart-checkout, ticket-checkout, ticket-embed, stripe-webhook and reconcile-orders. Use reconciled bundles, not an unqualified deploy from the monorepo. Retain the existing deployed fee, promo, pagination and outbound mail behavior where outside the patch. The updated Stripe receipt path needs the checked-in optional Resend deduplication header. The embed uses the checked-in explicit-cancel classifier; its service-only SQL RPC is already installed.
4. Verify old flow compatibility before exposing new web HTML. Squash-merge the approved PR head and put the corresponding production build on the live aliases; verify the site, non-writing checkout capability and staff boundaries. Do not buy or send using a live customer identity.

## Rollback

Keep the previous Vercel deployment available. Restore its aliases if the new web build fails. Keep additive SQL and compatible checkout Edge bundles during the drain so cached new clients and already-paid orders can still finish. Do not roll back the underlying Edge bundle blindly; restore its pinned previous source only after the affected web clients and in-flight orders are accounted for.
