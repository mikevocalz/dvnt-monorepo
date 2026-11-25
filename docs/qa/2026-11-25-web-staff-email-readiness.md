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
