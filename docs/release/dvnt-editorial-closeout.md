# DVNT disclosed editorial profiles (C01/C02/C03/C04)

**Source:** closed/unmerged PR #28, docs/workstreams/15-ai-editorial-profiles.md. The ten exact editorial lanes have been recovered in code. No member accounts, fake personas, published posts, likes, follows or payments were created.

## Data/UI foundation in this PR
- Payload CMS v4 collection definitions for the **existing** admin backend (registration gated behind `PAYLOAD_EDITORIAL_COLLECTIONS_READY=true` until schema provisioning is complete): editorial-channels and editorial-queue (dedicated payload schema, not public app tables).
- Ten canonical editorial lanes, disclosable as DVNT Editorial / AI-assisted. Channels default disabled; queue defaults draft.
- Staff-only record reads, admin-only channel management, moderation/staff queue authoring; no public channel API or publisher is active.
- Content queue tracks approval, optional factual source, provenance notes, moderator, scheduledAt and idempotency operation key.
- Publish decision is a **pure tested predicate**, not a scheduler; automated likes/follows explicitly return false.

## Requirements before feature completion
1. Generate a Payload migration/type map for the new collections against an isolated DB, including the shared document-lock relationship columns. Set `PAYLOAD_EDITORIAL_COLLECTIONS_READY=true` only after the reviewed migration is applied and tested. The adapter has push disabled by default; do not enable production auto-push.
2. Connect approved editorial channels to dedicated, visibly labeled identities (not humans) and create immutable account IDs without impersonation.
3. Add a publish worker and review queue with service-to-service authentication, scheduled retries, unique post operation IDs, expiry, pause-all and independent moderation. Only human-approved content may pass to publishing.
4. Daily news and Black Queer History must store trusted sources/citations and support corrections; do not invent quotes. Artistic-nude content needs adult-protected eligibility.
5. Add explicit editable provider content disclosure in feed/profile UI. Mobile and web must use existing DVNT design semantics, no second dashboard.
6. C03 automated engagement requires a **separate product-approved opt-in** and auditable limits; ban fake organic engagement loops. Remain OFF in this PR.
7. Two quiet initial pilots after test: Astrology and Cars/Architecture/Travel. Stage approvals first, then others.

Roles: Principal Payload architect, Distinguished Trust/Content Safety, AI provenance reviewer, staff scheduler engineer, UX/accessibility, marketing/copy review and SRE. Skills: Matt Pocock/skills, Supabase, Impeccable, Mobbin, coreyhaines31/marketingskills, petergyang/no-ai-slop. **No merge/deploy or automated outreach.**
