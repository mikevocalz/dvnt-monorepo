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
