// src/app/api/comments/route.ts — create/report blog comments.
// POST: verify the app (Better Auth) session → resolve the member → create the
// comment via the Payload LOCAL API (same process, no HTTP round-trip to our own
// REST endpoint). The collection's moderation hooks (banned/suspended/
// shadow_banned) still run, so a blocked member is rejected. PUT: file a report.
import type { NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { verifyAppSession } from '@/lib/verifyAppSession'

let _payload: Promise<any> | null = null
function payloadClient() {
  if (!_payload) _payload = getPayload({ config })
  return _payload
}

function bearer(req: NextRequest) {
  const h = req.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : undefined
}

// Relationship ids are integers in these collections; coerce numeric strings.
const asId = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)

// GET: resolve the signed-in app member's id so the blog can tell which comments
// are the viewer's own (the client session exposes the Better Auth *user* id,
// not the Payload *member* id that comments.authorMember points to).
export async function GET(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  return Response.json({ memberId: session?.memberId ?? null }, { status: 200 })
}

export async function POST(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { postId, body, parentId } = await req.json().catch(() => ({}))
  if (!postId || !body?.trim()) return Response.json({ error: 'post and body required' }, { status: 400 })
  if (body.length > 4000) return Response.json({ error: 'too long' }, { status: 400 })

  try {
    const payload = await payloadClient()
    const doc = await payload.create({
      collection: 'comments',
      overrideAccess: true, // bypass create:false; moderation hooks still enforce status
      depth: 1, // populate authorMember so the optimistic UI shows the real avatar/name
      data: {
        post: asId(postId),
        authorMember: asId(session.memberId),
        parent: parentId ? asId(parentId) : undefined,
        body: body.trim(),
        status: 'visible',
      },
    })
    return Response.json({ ok: true, comment: doc }, { status: 201 })
  } catch (e: any) {
    if (e?.status === 403) return Response.json({ error: 'blocked' }, { status: 403 })
    console.error('[comments] create failed:', e?.message ?? e)
    return Response.json({ error: 'create failed' }, { status: 502 })
  }
}

// Load a comment and confirm the session member authored it. Returns the comment
// doc (depth 0) on success, or a Response to return immediately on failure.
async function ownComment(payload: any, commentId: unknown, memberId: string) {
  const id = asId(commentId)
  const doc = await payload.findByID({ collection: 'comments', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!doc) return { error: Response.json({ error: 'not found' }, { status: 404 }) }
  const author = (doc as any).authorMember
  const authorId = typeof author === 'object' && author ? author.id : author
  if (String(authorId) !== String(memberId)) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { doc, id }
}

// PATCH: the author edits their own comment body.
export async function PATCH(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { commentId, body } = await req.json().catch(() => ({}))
  if (!commentId || !body?.trim()) return Response.json({ error: 'comment and body required' }, { status: 400 })
  if (body.length > 4000) return Response.json({ error: 'too long' }, { status: 400 })

  try {
    const payload = await payloadClient()
    const owned = await ownComment(payload, commentId, session.memberId)
    if ('error' in owned) return owned.error
    const doc = await payload.update({
      collection: 'comments',
      id: owned.id,
      overrideAccess: true,
      data: { body: body.trim(), editedAt: new Date().toISOString() },
    })
    return Response.json({ ok: true, comment: doc }, { status: 200 })
  } catch (e: any) {
    console.error('[comments] edit failed:', e?.message ?? e)
    return Response.json({ error: 'edit failed' }, { status: 502 })
  }
}

// DELETE: the author removes their own comment. Hard delete; the client drops the
// node (and its subtree) from the thread.
export async function DELETE(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { commentId } = await req.json().catch(() => ({}))
  if (!commentId) return Response.json({ error: 'commentId required' }, { status: 400 })

  try {
    const payload = await payloadClient()
    const owned = await ownComment(payload, commentId, session.memberId)
    if ('error' in owned) return owned.error
    await payload.delete({ collection: 'comments', id: owned.id, overrideAccess: true })
    return Response.json({ ok: true }, { status: 200 })
  } catch (e: any) {
    console.error('[comments] delete failed:', e?.message ?? e)
    return Response.json({ error: 'delete failed' }, { status: 502 })
  }
}

// PUT: report a comment into the existing reports queue (category "comment").
export async function PUT(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { commentId, reportedMemberId, reason } = await req.json().catch(() => ({}))
  if (!commentId) return Response.json({ error: 'commentId required' }, { status: 400 })

  try {
    const payload = await payloadClient()
    await payload.create({
      collection: 'reports',
      overrideAccess: true,
      data: {
        category: 'comment',
        status: 'open',
        reporter: asId(session.memberId),
        reportedMember: reportedMemberId ? asId(reportedMemberId) : undefined,
        reportedComment: asId(commentId),
        reason: reason ?? '',
      },
    })
    return Response.json({ ok: true }, { status: 201 })
  } catch (e: any) {
    console.error('[comments] report failed:', e?.message ?? e)
    return Response.json({ error: 'report failed' }, { status: 502 })
  }
}
