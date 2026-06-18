// src/lib/comments.ts — blog comment fetch + threading.
// Reads visible comments for a post via Payload's LOCAL API (Payload runs
// in-process in this Next app — same instance that powers /admin and lib/posts).
// No HTTP round-trip: the previous REST fetch hit PAYLOAD_URL (unset) at the
// wrong path (/api/comments is this app's POST-only custom route, not Payload's
// /payload-api), so every server render returned [] and comments vanished on
// refresh. Shadow-banned comments are filtered for everyone except their own
// author (the viewerId is resolved client-side from the app session).
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

export type CommentDoc = {
  id: string
  body: string
  createdAt: string
  editedAt?: string | null
  parent?: string | { id: string } | null
  shadowed?: boolean
  status?: string
  authorMember: string | { id: string; username?: string; avatarUrl?: string }
}

export type CommentNode = CommentDoc & { children: CommentNode[] }

let _payload: Promise<Payload> | null = null
function client(): Promise<Payload> {
  if (!_payload) _payload = getPayload({ config })
  return _payload
}

// Relationship ids are integers in these collections; coerce numeric strings.
const asId = (v: string): string | number => (/^\d+$/.test(v) ? Number(v) : v)

const mapAuthor = (m: any): CommentDoc['authorMember'] =>
  m && typeof m === 'object'
    ? { id: String(m.id), username: m.username ?? undefined, avatarUrl: m.avatarUrl ?? undefined }
    : String(m)

function docToComment(d: any): CommentDoc {
  const parent = d.parent
  return {
    id: String(d.id),
    body: d.body ?? '',
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date(0).toISOString(),
    editedAt: d.editedAt ? new Date(d.editedAt).toISOString() : null,
    parent: parent == null ? null : typeof parent === 'object' ? { id: String(parent.id) } : String(parent),
    shadowed: !!d.shadowed,
    status: d.status,
    authorMember: mapAuthor(d.authorMember),
  }
}

export async function getCommentsForPost(postId: string): Promise<CommentDoc[]> {
  try {
    const payload = await client()
    const res = await payload.find({
      collection: 'comments',
      where: { and: [{ post: { equals: asId(postId) } }, { status: { equals: 'visible' } }] },
      depth: 1,
      limit: 500,
      sort: 'createdAt',
      overrideAccess: true,
    })
    return res.docs.map(docToComment)
  } catch (e) {
    console.error('[comments] find failed:', (e as any)?.message)
    return []
  }
}

const parentId = (c: CommentDoc): string | undefined =>
  c.parent == null ? undefined : typeof c.parent === 'object' ? c.parent.id : c.parent

const authorId = (c: CommentDoc): string =>
  typeof c.authorMember === 'object' ? c.authorMember.id : c.authorMember

/** Nest a flat comment list into a tree, hiding shadowed comments from everyone
 *  except their author (viewerId). */
export function buildTree(flat: CommentDoc[], viewerId?: string): CommentNode[] {
  const visible = flat.filter((c) => !c.shadowed || authorId(c) === viewerId)
  const byId = new Map<string, CommentNode>()
  visible.forEach((c) => byId.set(c.id, { ...c, children: [] }))
  const roots: CommentNode[] = []
  byId.forEach((node) => {
    const pid = parentId(node)
    const parent = pid ? byId.get(pid) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  return roots
}
