// src/lib/comments.ts — blog comment fetch + threading.
// Reads visible comments for a post from the Payload REST API and nests them.
// Shadow-banned comments are filtered for everyone except their own author
// (the viewerId is resolved client-side from the app session).
const PAYLOAD_URL = process.env.PAYLOAD_URL || process.env.NEXT_PUBLIC_PAYLOAD_URL || ''

export type CommentDoc = {
  id: string
  body: string
  createdAt: string
  parent?: string | { id: string } | null
  shadowed?: boolean
  status?: string
  authorMember: string | { id: string; username?: string; avatarUrl?: string }
}

export type CommentNode = CommentDoc & { children: CommentNode[] }

export async function getCommentsForPost(postId: string): Promise<CommentDoc[]> {
  if (!PAYLOAD_URL) return []
  try {
    const res = await fetch(
      `${PAYLOAD_URL}/api/comments?where[post][equals]=${encodeURIComponent(postId)}&where[status][equals]=visible&depth=1&limit=500&sort=createdAt`,
      { cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data?.docs ?? []) as CommentDoc[]
  } catch {
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
