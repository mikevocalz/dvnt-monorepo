# Scanner staff isolation

## Behavior

- The host and accepted admin/editor/scanner co-organizers retain access. Merely signing in, an unaccepted invitation, or staffing another event does not grant scanning rights.
- Each session gets 30 attempts/minute. Different accounts and different authenticated sessions on the same account do not share that lane, even on venue Wi-Fi.
- A verified account is capped at 120 attempts/minute across its sessions. Client-supplied `device_id` is audit metadata, not authority to reset a quota.
- Pre-auth ceilings are 600/minute per forwarded-IP bucket (or one missing-IP bucket), plus 6,000/minute across the isolate independent of spoofable forwarded headers. Session buckets use SHA-256 fingerprints, never raw credentials.
- All limits remain best-effort, per-isolate memory counters, not distributed durable quotas. The coarse ceilings are deliberate overload protection, not a guarantee of unlimited shared-network throughput.
- Native and web distinguish signed-out, explicit 403 staff denial, pending/paused role resolution, and retryable verification errors. A retry never bypasses server authorization.
- Offline web proof is viewer-and-event scoped, expires after 24 hours, and is forgotten after explicit denial. Event-only v1 proof is intentionally ignored; existing devices must confirm staff status once online to create v2 proof. A first query paused offline does not erase valid proof.
- Native scanner logs no bearer QR values or prefixes. Redemption and authorization remain enforced server-side.

## Verification

`pnpm test:scanner-staff` runs endpoint fixtures with actual session-verification, limiter and access-gate code, API status-preservation checks, role-memory isolation tests, and isolated native gate render/interaction tests. The redemption RPC is simulated; these tests do not replace Postgres CAS tests or physical-camera QA.

Before-fix replay of the new endpoint fixtures against the original endpoint failed five of nine checks, including shared-IP/session interference. Final focused suite: 59 passing checks.

Locally, the script body ran directly with isolated dependencies because the available pnpm bootstrap attempted an unavailable local installation. Focused strict helper type checks, TSX syntax compilation, hook-rule lint and static edge-function verification passed. App-wide boundary lint could not resolve missing `expo/tsconfig.base`; full workspace build/typecheck and real iOS/Android/browser camera behavior were not verified in this container.

## Release

No database migration is needed. Server changes require deployment of `ticket-scan` and its shared helper. Gate/role-memory changes require web and native application releases. This work does not deploy anything, grant staff roles, or perform live check-ins. These reproduced defects are not proof of the exact cause of a reported device incident without its error/log evidence.
