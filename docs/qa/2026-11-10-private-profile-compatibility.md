# Private-profile compatibility follow-up (source only)

This follows released PR #255. Nothing in this follow-up authorizes deployment,
notification production, raw graph restriction, native updates or live migrations.

## Implemented path

- A read-only Better Auth endpoint returns only the authenticated viewer's own
  relationships. Account identity is verified server-side; caller-selected viewer
  IDs cannot request another member's graph. No provisioning or relationship
  mutation is performed. Current clients use this service for profile markers,
  Activity markers and unread inbox classification rather than relying on
  anonymous PostgREST fallback. Failures remain unknown/retry, not “not following”.
- Held notification producers write legacy-readable system envelopes with honest
  title/body and a semantic type. Current direct/bootstrap consumers restore the
  request/approval presentation. Old clients can read the notice, but their row
  taps do not gain review controls. The request notice tells them to open the
  website manually. This is display compatibility, not full native compatibility.
- A strict read-only evidence validator keeps the release held until supported
  build/runtime/update mappings, real-device acceptance and fleet disposition
  evidence are supplied. A passing document is not proof of every installation.

## Actual release evidence and limits

The repository hardcodes version 1.0.0, uses fingerprint runtime compatibility,
zero cached-launch delay and per-runtime OTA matching. A current source commit
or web deployment does not identify installed native source. Available production
schema has no app_version/runtime/build_number/update_id columns; no EAS CLI/token
or installed-client release attestation was available in this workspace. The
connected Mac was offline. No specific native cohort has been certified here.

Anonymous legacy relationship requests are indistinguishable from unauthorized
requests. Keeping those reads working would retain the exposure. A new endpoint
cannot alter a binary that never calls it. Likewise, older direct Activity readers
cannot be repaired by changing bootstrap projection alone.

## Future release order (requires separate approval)

1. Deploy the new relationship endpoint before clients that require it, then ship
   compatible web and native consumers per supported runtime. Exercise failures,
   recovery, account switches and inbox classification on actual installed builds.
2. Inventory and visibly retire/upgrade unsupported anonymous clients; there is no
   existing enforced minimum-build mechanism that can certify this automatically.
3. Review the compatibility evidence and explicitly approve raw graph gate10300.
   Do not restore anonymous private access to work around compatibility problems.
4. Independently approve notification producer10100 only after current consumers
   and the limited legacy fallback have been reviewed. Any temporary web-only
   review fallback must be disclosed; this does not supply missing native UI.

All existing follow grants and ID-verification policy remain unchanged. Never
bulk-push pending migrations: held producers and access policy require separate
release decisions. Previously distributed media URLs cannot be revoked here.
