# Private-follow installed-client compatibility evidence

**Held. No installed-client acceptance is recorded in the example.** This tooling
does not activate SQL, deploy clients, send requests, or change existing follows.
Passing CI checks the held declaration and synthetic validator fixtures only.

An anonymous legacy REST request cannot be distinguished securely from an
unauthorized person enumerating private relationships. Never exempt user-agent
strings, supplied user IDs, version headers, or filters from the restrictive
policy. A new endpoint cannot repair already-installed anonymous callers.

## Actual release evidence needed

Inventory supported iOS/Android build and runtime cohorts first. Match each
tested device launch to its native build plus embedded source, or OTA update ID
and source commit. The hardcoded version label alone is not evidence.
Fingerprinted runtimes mean one OTA does not cover all installed binaries. See
[native launch identification](native-live-photo-acceptance.md).

Copy the example to a separate evidence document, replace inventory placeholders
and set the exact candidateSourceCommit. Each device record requires:

- Unique id, declared cohortId, matching platform, build, runtimeVersion.
- appVersion, osVersion, tester, testedAt, realDevice: true, and environment
  equal to production-synthetic-accounts.
- launch equal to embedded with embedded: true and updateId: null; or launch
  equal to ota with embedded: false and the actual updateId.
- Full sourceCommit, HTTPS sourceMappingEvidenceUrl and evidenceUrl.
- checks containing every ID exported as CASES by the validator, each with
  status: pass and its HTTPS evidenceUrl. Cases cover preserved/own relationships,
  private outsider denial, approve/decline/cancel, Activity, bridge failure without
  false markers, recovery, inbox/spam and account switching.

Use authorized synthetic accounts. Do not include relationship IDs, credentials,
or real-user private graph data. Evidence URLs should be access controlled.
The validator checks declaration structure, not evidence truth or reachability.

Every declared cohort needs device evidence. This still does **not** prove all
installations are compatible. A separate fleetReview requires inventory evidence,
the reviewed disposition of unsupported clients (verified upgrades or visible
retirement), reviewer and timestamp. Explicitly record no remaining supported
anonymous legacy clients only when verified, never merely because current source
contains a JWT bridge. This change establishes neither a verified fleet inventory
nor an enforced minimum-build rollout.

## Commands and boundary

    node scripts/check-private-follow-compatibility.cjs --declaration-only
    node scripts/check-private-follow-compatibility.cjs path/to/evidence.json
    node --test scripts/test-private-follow-compatibility.cjs

Strict validation requires status equal to ready-for-review. The default fails
closed. Even structurally complete evidence produces only a manual-review result,
never authorization or execution of migration 10300 or notification producers.

The rollout remains: authenticated compatible clients, native rollout per runtime,
device and fleet review, then separately authorized activation. Until then raw
social-graph privacy is incomplete. Existing follows and ID policy are unchanged.

## Legacy-readable notification fallback (source only)

The held `20261110010100` producer writes `system` rows with `semantic_type`
`follow_request` or `follow_request_approved`, actor-specific title and readable
body. The shared current Activity client normalizes these two known semantics
in both direct notification DTOs and bootstrap hydration. IDs, read timestamps,
actor/entity identity and transition idempotence remain unchanged. Cancellation,
decline and approval remove both legacy typed and semantic pending rows, not
unrelated announcements.

This is **not full installed-native compatibility or authorization to activate
the producer**. The audited pre-weekly `d1f03d8` Activity renders system title/body
but ignores payload URLs and routes to the actor profile. Its privacy screen
has no request-review controls. Request copy therefore explicitly directs older
users to open `dvntapp.live` in their browser and choose Settings > Privacy >
Follow requests. That is a manual web fallback, not a working native review tap.
Do not claim that push tapping opens a usable review screen on those builds.
Compatible native rollout and the evidence above remain required.
