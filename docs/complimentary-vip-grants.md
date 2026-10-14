# Complimentary VIP grants

Prepared implementation only. Applying migrations, deploying readers, and issuing any grant are separate operational actions. This change seeds no recipients.

## Data and authority

- `membership_grants` is separate from paid Stripe / App Store / Google Play subscription records. A grant never creates a processor customer, changes a role, cancels a paid subscription, or calls a billing API.
- Only trusted service tooling can execute `grant_complimentary_vip` and `revoke_complimentary_vip`. Ordinary clients cannot write grants or audit rows, even for themselves. Service-role direct table mutations are also denied; use the audited RPCs.
- Each request has a stable UUID idempotency key, stable actor and recipient profile IDs, canonical auth-identity snapshots, a reason, and a database timestamp. A retry must have identical inputs. Audit records are append-only through the exposed API.
- Grants bind to the exact current profile/auth pair, so an account identity reassignment does not transfer a grant. Granting requires unique mapped recipient and actor identities. Actor IDs must be verified by the trusted operator; there is no public staff grant endpoint.
- The requested complimentary VIP batch has no expiry (`expiresAt: null`). Expiring grants remain supported and tested by the underlying primitive for safe future use, but the batch preparer rejects a non-null expiry.
- No implicit staff cohort exists. Future administrators/moderators do not receive grants automatically. Unmatched console identities require separate resolution and must not be guessed or created.

## Reads

The client and room server read complimentary records alongside their paid subscription records. Highest active tier wins, so paid Founders Circle remains above complimentary VIP. Revoked/expired grants confer no access. Existing paid records continue to govern billing and reappear as the effective tier when a higher grant ends.

`effective_membership_tiers` is a service-only projection used by `is_entitled`, door roster/scanner perks and the existing authenticated profile badge view. Paid subscription identity mapping uses the room-repair migration's canonical-owner-first helper: verified numeric profile ownership is retained unless that key is another user's canonical auth ID.

`user_badge_tiers` preserves its signed-in profile badge contract: numeric profile `user_id`, `username`, and `plan_key`. No auth IDs, actor identities, reasons, processor IDs, or billing data are exposed. Anonymous callers remain denied, matching the verified live ACL. Existing badge artwork and components are reused.

## Prepare an approved batch

Keep the manifest and generated SQL private and out of Git. A manifest contains:

```json
{
  "actor": { "id": 1, "username": "operator", "authId": "synthetic-actor" },
  "reason": "Explicit owner approval, with a reference to the reviewed request",
  "expiresAt": null,
  "recipients": [
    { "id": 2, "username": "synthetic-member", "authId": "synthetic-subject", "eligibility": { "kind": "named_recipient" }, "requestId": "00000000-0000-4000-8000-000000000001" }
  ]
}
```

Run `node scripts/prepare-complimentary-vip-grants.mjs private-manifest.json private-grants.sql`. The script only writes SQL; it has no database/network functionality. Output creation fails rather than overwriting a file. Review the exact manifest, actor, and SQL before using an existing approved administrative SQL session that can read/lock the Payload tables and switch locally to `service_role`. Preflight runs before that role switch; transaction locks stay held, and only grant invocation/readback uses `service_role`. No schema/table privileges are added. A standalone service-role session without Payload access cannot perform this preflight. Every identity and moderation snapshot is checked and locked in one serializable transaction before the first grant, and any mismatch aborts the batch. Staff recipients use `eligibility: { "kind": "payload_staff", "adminUserId": 20, "expectedRole": "admin" }` instead: the exact Payload row, role and case-insensitive app-email mapping are rechecked; new staff are never selected. An effective-tier readback must confirm every intended active, non-expiring grant before commit. Reuse the same request IDs on retries.

For revocation, execute the service-only revoke RPC with a new stable request ID, the exact grant ID, verified actor ID and reason. No paid record is changed.

## Rollout order and verification

1. Before a separately approved rollout, capture the live definitions/owners/ACLs of `user_badge_tiers`, `is_entitled(text)`, `is_entitled_self()`, and the membership ownership policy; compare function signatures, badge column types, and any existing ownership helper definitions. Capture the five targeted deployed function bundles. The read-only verification on 2026-10-13 found the new grant objects/helpers and both migration versions absent, with badges authenticated-only, the general entitlement RPC service-only, and the self RPC authenticated-only.
2. Apply `20261013220600_membership_subscription_owner_reads.sql`, then `20261013230000_complimentary_membership_grants.sql`, **before either web merge can auto-deploy**. Use only these exact reviewed migrations, not a bulk database push. They seed no grants and preserve old table columns, badge types, RPC signatures and caller audiences. Verify zero grant rows, old authenticated badge queries and subscription reads, service entitlement reads, the own-only self RPC, and PostgREST schema availability before continuing. Paid-tier semantics intentionally become consistent for canonical/legacy identities, paid-through cancellation, expiry and highest-tier precedence; this is compatible, not behavior-neutral.
3. Deploy the approved current edge bundles after schema verification: `video_create_room`, `lynk-moq-token`, `video_end_room`, `get-event-tickets`, `ticket-scan`. New readers fail closed if their grant view is missing, so never reverse the schema/readers order. SQL entitlement RPCs and the badge view are updated by the grant migration and need no separate deployment.
4. Merge #83 only after approval. Wait for its automatic web deployment and smoke checks. Retarget #84 to `master`, review its exact diff and rerun checks; then separately approve/merge #84 and verify its automatic web deployment. Do not treat merging into the feature branch as a production release.
5. Only after those schema/function/web readbacks are healthy and the exact batch is approved, run the private transaction. Verify all intended users have VIP via service `is_entitled`, authenticated `is_entitled_self`, own grant reads and authenticated badge reads, and that processor subscription fields are unchanged.
6. Check a currently signed-in web client refreshes after grant/revocation, and verify existing event/room behavior in the deployed environment. A native store release does not need to block web activation: old native public-profile badges already query the existing signed-in badge view and can display VIP after cache refresh. However, the old native entitlement hook does not read grants, so its own-profile badge, billing display and client-side room controls may still show the free/paid-only state until updated. Backend room/door checks honor the grant. This change introduces no native module; use the normal compatible JS/OTA release path if supported, otherwise the normal app release path.

The optional `watch_door_summary` RPC is absent from the verified live schema even though the deployed `get-event-tickets` already contains its summary request branch. This pre-existing unavailable aggregate path is not created, altered, or claimed covered by this grant rollout. Its separate feature migration needs its own approval. Regular ticket roster and scanner perks are covered.

### Rollback

Keep additive tables/audit records in place; never delete processor records or audit history as a rollback. If the new readers fail, restore the previous web/function bundles while retaining the schema. Older clients ignore the grant source, and authenticated badge reads remain schema-compatible. If grant effects must also be withdrawn, use separately authorized audited revocations for the exact issued grant IDs before reverting readers, then verify the paid fallback and profile badges. A rollback must not claim that existing native clients already gained or lost local controls before their normal refresh/update.

Do not drop grant views while a deployed reader still queries them: the new entitlement readers deliberately fail closed on an incomplete snapshot. Any schema rollback needs its own reviewed dependency-aware script; there is no automatic destructive down migration.

Isolated PostgreSQL tests use PGlite and synthetic accounts only. They verify permissions, idempotency, actor audit, non-expiring grants, revocation/expiry, paid-tier preservation, legacy identity collisions, profile projection privacy, and roster/scanner tier parity. Client/server fixtures cover the same tier decisions. Local fixture checks do not substitute for an authorized migration/deployment smoke test.

## Known verification limits

- Scoped subscription/server TypeScript and hooks lint are green. The full app type check is still blocked by inherited dependency/type errors outside these grant files (including MoQ package API mismatch and existing UI types); do not describe it as a full type-check pass.
- Synthetic UI/source checks verify complimentary billing labels and suppression of covered-tier purchase buttons. A physical iOS/Android smoke test and a deployed browser/account readback have not been performed.
- Mounted badge and entitlement queries refresh every 30 seconds. Server checks are authoritative immediately; an already-visible badge may take up to that polling interval to reflect a revocation.
- Billing-provider reconciliation and checkout continue to read/write processor subscription records only. A complimentary grant does not cancel an existing paid plan or change its renewal. Standalone legacy subscription management remains a billing path, not an access source for comp grants.
