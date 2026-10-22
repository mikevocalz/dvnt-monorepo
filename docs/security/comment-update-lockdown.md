# Comment UPDATE lockdown

## Finding and scope

Read-only catalog inspection on 2026-10-22 found `public.comments` RLS enabled,
`anon` and `authenticated` table SELECT/INSERT/UPDATE grants, no explicit column
ACLs, public SELECT, and `comments_update_anon` (`TO anon USING (true) WITH CHECK
(true)`). No restrictive UPDATE/ALL policy or content/author UPDATE trigger
limits that capability. This establishes a database-role exposure, not a tested
public REST exploit. No production rows were modified to demonstrate it.

This migration removes the unused direct UPDATE path, not a product feature.
Both shipped post-comment clients (`packages/app/lib/api/comments.ts` and
`apps/mobile/lib/api/comments.ts`) invoke Edge Functions for writes. Neither
exposes editing. Better Auth identity is verified in those functions and does
not supply Supabase `auth.uid()`, so an `auth.uid() = author_id` policy would be
incorrect. Direct owner, cross-user and unauthenticated edits all fail closed;
clients cannot change authorship, content, counters or optional attachments.

Existing server paths remain unchanged: `add-comment` derives the author from a
verified session; `delete-comment` checks ownership; `toggle-comment-like` uses
service-role writes to comment_likes and existing counter triggers. Account/post
deletion and privileged operational writes retain their existing permissions.
There is no new service-role endpoint or privilege grant. A future edit endpoint
must verify the Better Auth session, resolve the app author, atomically filter
by comment id AND author id, allowlist editable fields, never accept author_id,
and test unauthenticated/cross-user denial before client release.

Blog comments are a different subsystem: Payload uses the `payload` schema
(`packages/cms/src/payload.config.ts`), author-checked PATCH in
`apps/web/src/app/(frontend)/api/comments/route.ts`, and existing collection
moderator access. This change only touches `public.comments` and leaves those
editing/moderation paths intact.

## Adjacent INSERT / DELETE review

The public INSERT policy is permissive but combines with restrictive
`verified_participation_boundary`; INSERT grants remain. DELETE policy is
permissive but neither client role has a DELETE grant. Existing post-counter
triggers and server-only caller architecture also matter. This focused patch
does not claim all adjacent write paths are fully hardened or alter them.
Tests preserve their fixture behavior. A separate INSERT authorization audit
should assess author spoofing and trigger dependencies before broader changes.

## Validation and rollout (not executed in production)

Run `node scripts/verify-comment-update-lockdown.mjs` with `pg` available and a
local Postgres server installation. Set `PG_BIN` to its bin directory if needed.
The harness creates fresh roles and synthetic tables in a temporary cluster,
reproduces the old role exposure, applies the migration twice, checks role and
column denials, unchanged SELECT/INSERT/DELETE, and service-role writes/counter
trigger execution. `--skip-migration` must fail. It never uses production URLs.
CI runs both checks. This is not an end-to-end deployed API test.

1. Review and approve this draft separately from the GIF feature. Recheck the
   production catalog for changed grants/policies and confirm no new direct
   client editor was introduced. The source scan in `verify:content-lockdown`
   must continue to show no client comment writes.
2. Apply the migration through the normal approved release process. No client or
   function deployment is needed for this unused-path closure. Re-read effective
   table/column privileges, the removed policy, and preserved service-role grants.
3. In an authorized staging environment smoke-test public text reads, signed-in
   creation/replies, likes/unlikes, owner deletion, and existing blog moderation.
   If the GIF feature is also installed, include GIF-only and mixed comments.
4. Monitor comment mutation errors after release. If a legitimate forgotten
   caller is found, route it through a verified server endpoint; do NOT restore
   broad anonymous UPDATE as rollback. Roll forward with least privilege.

The GIF migration is independent: it adds nullable `attachment` with a CHECK
and preserves text content. Either migration order is supported; the revoke loop
covers every existing column, while later columns inherit no table UPDATE grant.
No attachment constraint, row content, RLS enablement or unrelated policy changes
are included here. Neither migration has been applied by this task.
