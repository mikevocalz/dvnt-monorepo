// src/collections/hooks/moderation.ts
// Moderation side effects: every status transition writes an immutable
// `moderation_actions` row; bans fan keys into `ban_list` + revoke app
// sessions; reinstatement lifts keys. Writes to the locked collections use
// `overrideAccess` so the server trusts its own logic while the collections
// stay closed to direct edits.
import type { CollectionAfterChangeHook } from 'payload'
import { addBanKeys, liftBanKeys } from './banList'

const BAN_STATUSES = new Set(['banned', 'shadow_banned'])

/**
 * Revoke the member's app (Better Auth) sessions. Payload owns the admin-panel
 * session; Better Auth owns app-user sessions. They are separate stores, so a
 * ban here must call out to the app's session store.
 * TODO: wire to the Better Auth admin API / a Supabase RPC that revokes sessions.
 */
async function revokeAppSessions(appUserId?: string | null, logger?: any): Promise<void> {
  if (!appUserId) return
  // Placeholder: call Better Auth admin revoke endpoint or Supabase function here.
  logger?.info?.(`[moderation] (stub) revoke app sessions for appUserId=${appUserId}`)
}

export const onStatusChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
}) => {
  if (operation !== 'update') return doc
  const prevStatus = previousDoc?.status
  const nextStatus = doc?.status
  if (prevStatus === nextStatus) return doc

  const payload = req.payload
  const actorId = req.user?.id

  // Immutable audit row for every transition.
  await payload.create({
    collection: 'moderation-actions',
    data: {
      member: doc.id,
      action: nextStatus,
      previousStatus: prevStatus,
      reason: doc.lastModerationReason ?? undefined,
      actor: actorId,
      suspendedUntil: doc.suspendedUntil ?? undefined,
    },
    overrideAccess: true,
  })

  // Ban → fan keys into ban_list + revoke app sessions.
  if (BAN_STATUSES.has(nextStatus) && !BAN_STATUSES.has(prevStatus)) {
    await addBanKeys(payload, doc, doc.lastModerationReason ?? undefined)
    await revokeAppSessions(doc.appUserId, payload.logger)
  }

  // Reinstatement (→ active) lifts the member's ban_list keys.
  if (nextStatus === 'active' && BAN_STATUSES.has(prevStatus)) {
    await liftBanKeys(payload, doc.id)
  }

  return doc
}

const OPEN_REPORT_THRESHOLD = 3

/**
 * On a report write, recompute the count of open reports against the reported
 * member and auto-escalate them to `under_review` at the threshold. Writes an
 * audit row for the escalation.
 */
export const onReportChange: CollectionAfterChangeHook = async ({ doc, req }) => {
  const payload = req.payload
  const memberId = typeof doc.reportedMember === 'object' ? doc.reportedMember?.id : doc.reportedMember
  if (!memberId) return doc

  const open = await payload.count({
    collection: 'reports',
    where: { and: [{ reportedMember: { equals: memberId } }, { status: { equals: 'open' } }] },
    overrideAccess: true,
  })

  // Mirror the running count onto the member so the dashboard column is cheap.
  const member = await payload.findByID({ collection: 'members', id: memberId, overrideAccess: true })
  await payload.update({
    collection: 'members',
    id: memberId,
    data: { openReportsAgainst: open.totalDocs },
    overrideAccess: true,
    context: { skipModerationHooks: true },
  })

  // Auto-escalate at threshold (only from a non-escalated, active-ish state).
  if (
    open.totalDocs >= OPEN_REPORT_THRESHOLD &&
    member?.status === 'active'
  ) {
    await payload.update({
      collection: 'members',
      id: memberId,
      data: { status: 'under_review', lastModerationReason: `Auto-escalated at ${open.totalDocs} open reports` },
      overrideAccess: true,
    })
  }

  return doc
}
