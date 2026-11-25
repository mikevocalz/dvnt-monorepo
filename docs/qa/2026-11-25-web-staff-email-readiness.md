# Staff email readiness and rollout hold

This patch does not enable email invites or change the database. With invitations
enabled but delivery settings missing or inconsistent, owners cannot see or use
new email issuance. Previously issued links remain claimable, and authenticated
owners' existing revoke requests remain available, while delivery is paused.
The owner gate and exact verified contact/adult gates remain in the service RPC.

The isolated PostgreSQL/WASM regression uses both project invite migrations, the
actual route, encrypted outbox, worker and claim. It queues before the invited
account exists, captures one request in a synthetic provider, creates the
profile in the fixture, verifies that wrong/unverified identities cannot claim,
and checks that verified repeat acceptance grants exactly one Manager role. It
does not use a real auth signup, inbox, push device or provider.

Before enabling in any live environment:
- Bind the dedicated worker to the same exact HTTPS site and RPC origin.
- Verify the approved sender domain, credentials and that provider link tracking
  remains disabled. Configure and verify authenticated scheduling.
- In private staging, prove one consented real inbox arrival, the original link's
  fragment surviving delivery unrewritten, verified signup, acceptance/role
  persistence, and invitation revocation. Provider API acceptance is not proof
  of inbox arrival. Use separate consenting staff test endpoints to verify push.
- Do not enable a phone route until the account system has a verified-phone
  factor. Do not substitute checkout phone values or a guest ticket link.

## Existing-account staff push routing

The separate `invite-co-organizer` Edge path preserves its existing in-app
Activity row and native Expo payload. Valid native Expo tokens are sent only
to Expo. Valid browser subscriptions use the project's VAPID record and open
`/feed/activity`, where pending invitations can be accepted. Malformed or
non-provider endpoints, VoIP tokens and tokens belonging to other recipients
are not sent. The repository fixture substitutes both providers and proves
that a failure in one transport neither suppresses the other nor undoes a
role/invitation mutation. This is not device receipt proof.

For a real private-stage browser acceptance test, sign in as the authorized
stage staff recipient, enable push on the stage origin in notification
settings (an installed Home Screen web app is required for iPhone Web Push),
have a stage event owner send one pending invitation to that recipient, and
verify the on-device banner, its Activity click target and role after taking
action. Use only consented stage identities, a stage-matched VAPID record and
a separate browser profile; never call this with a production destination.
