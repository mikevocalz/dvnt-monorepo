// src/app/api/comments/route.ts — create/report comments on the blog.
// POST: verify app session (Supabase) → call Payload's custom /comments/submit
// endpoint with the shared service token. Payload's hooks enforce moderation,
// so a banned member is rejected even if this layer is bypassed.
import type { NextRequest } from 'next/server'
import { verifyAppSession } from '@/lib/verifyAppSession'

const COMMENT_SERVICE_TOKEN = process.env.COMMENT_SERVICE_TOKEN || ''

// Payload runs in THIS app under routes.api = '/payload-api'. Call it on the
// same origin as the incoming request (works on any domain/preview without a
// PAYLOAD_URL env), falling back to an explicit env if provided.
function payloadBase(req: NextRequest) {
  return process.env.PAYLOAD_URL || new URL(req.url).origin
}

function bearer(req: NextRequest) {
  const h = req.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : undefined
}

export async function POST(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { postId, body, parentId } = await req.json().catch(() => ({}))
  if (!postId || !body?.trim()) return Response.json({ error: 'post and body required' }, { status: 400 })
  if (body.length > 4000) return Response.json({ error: 'too long' }, { status: 400 })

  const res = await fetch(`${payloadBase(req)}/payload-api/comments/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-comment-service-token': COMMENT_SERVICE_TOKEN },
    body: JSON.stringify({ post: postId, authorMember: session.memberId, parent: parentId ?? null, body: body.trim() }),
  })

  if (res.status === 403) return Response.json({ error: 'blocked' }, { status: 403 })
  if (!res.ok) return Response.json({ error: 'create failed' }, { status: 502 })
  const created = await res.json()
  return Response.json({ ok: true, comment: created.comment }, { status: 201 })
}

// PUT: report a comment into the existing reports queue (category "comment").
export async function PUT(req: NextRequest) {
  const session = await verifyAppSession(bearer(req))
  if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const { commentId, reportedMemberId, reason } = await req.json().catch(() => ({}))
  if (!commentId) return Response.json({ error: 'commentId required' }, { status: 400 })

  const res = await fetch(`${payloadBase(req)}/payload-api/comments/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-comment-service-token': COMMENT_SERVICE_TOKEN },
    body: JSON.stringify({ commentId, reportedMemberId, reporter: session.memberId, reason: reason ?? '' }),
  })
  if (!res.ok) return Response.json({ error: 'report failed' }, { status: 502 })
  return Response.json({ ok: true }, { status: 201 })
}
