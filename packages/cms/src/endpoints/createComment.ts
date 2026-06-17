// src/endpoints/createComment.ts
// Custom Payload endpoints hit by the blog's /api/comments route. The blog has
// already verified the app session; these endpoints trust a shared service token,
// then create with overrideAccess so the collection's create:false (which blocks
// the anonymous public) doesn't apply. The beforeOperation hook still runs, so
// moderation (banned/suspended/shadow_banned) is enforced here.
import type { Endpoint } from 'payload'
import { APIError } from 'payload'

export const createCommentEndpoint: Endpoint = {
  path: '/submit',
  method: 'post',
  handler: async (req) => {
    const token = req.headers.get('x-comment-service-token')
    if (!token || token !== process.env.COMMENT_SERVICE_TOKEN) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    const body = await (req as any).json?.()
    const { post, authorMember, parent, body: text } = body ?? {}
    if (!post || !authorMember || !text?.trim()) {
      return Response.json({ error: 'post, authorMember, body required' }, { status: 400 })
    }

    try {
      const doc = await req.payload.create({
        collection: 'comments',
        overrideAccess: true, // bypass create:false; hooks still enforce moderation
        data: { post, authorMember, parent: parent ?? undefined, body: text.trim(), status: 'visible' },
      })
      return Response.json({ ok: true, comment: doc }, { status: 201 })
    } catch (e: any) {
      const status = e instanceof APIError ? e.status : 500
      return Response.json({ error: e?.message ?? 'create failed' }, { status })
    }
  },
}

// Report a comment into the reports queue. Same service-token trust model.
export const reportCommentEndpoint: Endpoint = {
  path: '/report',
  method: 'post',
  handler: async (req) => {
    const token = req.headers.get('x-comment-service-token')
    if (!token || token !== process.env.COMMENT_SERVICE_TOKEN) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    const { commentId, reportedMemberId, reporter, reason } = (await (req as any).json?.()) ?? {}
    if (!commentId) return Response.json({ error: 'commentId required' }, { status: 400 })
    try {
      await req.payload.create({
        collection: 'reports',
        overrideAccess: true,
        data: {
          category: 'comment',
          status: 'open',
          reporter,
          reportedMember: reportedMemberId,
          reportedComment: commentId,
          reason: reason ?? '',
        },
      })
      return Response.json({ ok: true }, { status: 201 })
    } catch (e: any) {
      return Response.json({ error: e?.message ?? 'report failed' }, { status: 500 })
    }
  },
}
