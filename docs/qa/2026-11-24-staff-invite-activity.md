# Staff invite activity verification

## Confirmed defect

The active `invite-co-organizer` function accepts membership and notifies the inviter, but leaves the invitee's actionable activity in place. On repeat acceptance it returns before doing any cleanup. Both activity screens used row-local state to show Accepted, so reopening/reloading restores the same old invite.

This change retires only the actionable activity matching the current accepted membership ID, recipient, inviter and notification type. Accepting again safely clears an already accepted row without a second role grant or inviter notification. An unsuccessful cleanup remains retryable without changing the committed membership. The clients refresh only the initiating viewer's exact activity, notifications and badge keys. There is no migration, destructive bulk backfill, access expansion, account creation or provider change. A previously affected recipient can tap Accept once after rollout to reconcile the old actionable row.

If either numeric profile mapping is missing, the server does not claim notification cleanup or try a less-specific delete. The membership stays accepted. The response asks the recipient to refresh Activity and retry; normal database read/delete failures also remain retryable.

## Permission boundaries to preserve

- Owner: manages all staff roles including co-host/admin; destructive/financial actions remain owner-only.
- Accepted co-host/admin: staff scanner/manager grants or revocations, event and ticket catalog editing, and door tools. Cannot grant/revoke admin.
- Accepted manager/editor: event content and ticket tier/price/add-on editing and door tools, not staff grants.
- Accepted scanner: check-in and scoped/redacted door roster. Exact contact lookup stays behind the event-scoped authorized staff service; not a directory, broad contact query, or edit grant.
- Pending, revoked, unrelated, and signed-out accounts receive no management authority.

Existing account-based staff management is not the same as prospective staff onboarding. The staff picker requires an existing username/account; the already deployed guest invitation and ticket claim features only grant attendee/ticket access. A phone comp claim proves possession of a link plus an admitted account; it does not bind a verified phone on that account to the invite. Do not reuse it for staff authority.

A future prospective-staff flow needs a separate pending invitation record with event/role/inviter binding, a short-lived single-use hashed token, and an exact verified contact match to the signed-in recipient. Claim and role insertion must be atomic, check inviter authorization again, reject revoked/expired/replayed mismatched claims, avoid exposing whether an account exists, and retain registration/adult-verification gates. Queue contact invitations only after event creation returns its canonical saved ID; publish failure or retry cannot issue duplicate grants or deliveries. Email and device-mediated phone delivery each need their own staging proof. No prospective staff claim is implemented here.

## Verification

`node --test apps/mobile/supabase/functions/invite-co-organizer/accepted-invite-activity.test.cjs packages/app/lib/events/event-role.test.ts`

The focused handler test executes the actual HTTP handler with only its database, session, and push interfaces substituted. No real user account, notifications, or data writes are used. Before any coordinated release, run the established co-host and scanner-contact suites on the integrated candidate, then verify synthetic staff accounts on web/native: grant or invite, accept, reopen activity from a second session, and inspect the badge, role matrix and door search including pending/revoked negatives. No signed-in runtime/staging matrix is implied by these tests.
