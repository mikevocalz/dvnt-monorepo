# DVNT member and anonymous-room proximity — P04, P05, S09

Recovered **only** the minimal service-role-only presence table, Better Auth Edge endpoint, API/hook and web sync scaffold from the **unmerged** PR #31. No untrusted mileage based on Atlanta city centroids. No location is published or revealed on this branch by default, and no production migration was applied.

## Privacy rules
- Explicit device permission is NOT consent to share proximity with other members. A user must activate time-limited publishing and be able to revoke it.
- Raw coordinates are encrypted/DB-only behind service-role privileges and cannot be fetched from a public profile or chat roster.
- The server uses both participants' verified grants, applies block/private visibility, and returns a COARSE distance band. Do not return 0.1-mile precision or arbitrary viewer-chosen coordinates (trilateration).
- Permission denied, no grant, offline, stale or private target: show human-readable city only if previously public, otherwise "Distance unavailable"; do not make up feet/miles.
- Anonymous room avatars may show only privacy-safe, opted-in **bands**, never a real account name, home address, exact coordinates or identity linkage.

## Remaining implementation before feature completion
- Bind profile cards to memberProximityApi in current master UI, with a consent control and revocation/expiry states (do not silently activate).
- Native Expo location permission and shared profile opt-in wiring.
- Separate anonymous-room audience-safe edge query with no identity disclosure and a room-scoped consent boundary.
- Black-box session/consent tests for blocked profiles, renamed members, self, stale grants, active sessions, 100 mixed mobile/web requests and repeated probes, plus device UX evidence.
- Assert migration RLS and data-minimizing responses against a Supabase staging branch and review data retention TTL.
- Keep PR draft. A09 does not exist; the owned requirements are P04/P05/S09.

Skills/review: Supabase security and Postgres, expo/skills, Matt Pocock TypeScript, Argent agent-device, Impeccable and Mobbin for UI. Review old PRs #23 and #31 for intent, not as merge approvals.
