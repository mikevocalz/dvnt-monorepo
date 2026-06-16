// src/collections/hooks/commentGuards.ts
// Server-trusted moderation gates for comments. These run regardless of how the
// comment was submitted (the blog endpoint creates with overrideAccess), so the
// member's moderation status is the single source of truth.
import type { CollectionBeforeOperationHook, CollectionBeforeValidateHook } from 'payload'
import { APIError } from 'payload'

// Normalize author + derive thread root/depth from the parent.
export const stampCommentAuthor: CollectionBeforeValidateHook = async ({ data, req, operation }) => {
  if (!data) return data
  if (operation === 'create') {
    if (data.parent) {
      const parent = await req.payload
        .findByID({ collection: 'comments', id: data.parent, depth: 0, overrideAccess: true })
        .catch(() => null)
      if (parent) {
        data.threadRoot = parent.threadRoot ?? parent.id // inherit root
        data.depth = (parent.depth ?? 0) + 1
      }
    } else {
      data.depth = 0
      // threadRoot for a top-level comment is itself; set in afterChange since
      // we don't have the id yet. Left null here, backfilled there.
    }
  }
  if (operation === 'update') data.editedAt = new Date().toISOString()
  return data
}

// Hard gate: a comment cannot be created by a member who is banned or suspended;
// a shadow_banned member's comment is created but flagged `shadowed`.
export const blockBannedComment: CollectionBeforeOperationHook = async ({ operation, req, args }) => {
  if (operation !== 'create') return args
  const data = (args?.data ?? {}) as Record<string, any>
  const memberId = data.authorMember
  if (!memberId) throw new APIError('Missing author', 400)

  const member = await req.payload
    .findByID({ collection: 'members', id: memberId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!member) throw new APIError('Unknown author', 400)

  switch (member.status) {
    case 'banned':
    case 'suspended':
      req.payload.logger.info(`[comments] blocked ${member.status} member ${memberId}`)
      throw new APIError("You can't comment right now.", 403)
    case 'shadow_banned':
      data.shadowed = true // visible only to the author downstream
      break
    default:
      data.shadowed = false
  }
  return args
}
