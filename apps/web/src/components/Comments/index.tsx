'use client'
// components/Comments — threaded blog comments in the DVNT design language,
// built from @expo/html-elements (semantic DOM) + solito/image + react-native
// primitives for the interactive bits. No raw HTML tags. Rounded-square avatars
// (the DVNT rule — never circles).
//
// Authors can edit and delete their OWN comments: edit is an inline cross-fade
// form, delete asks for confirmation via a Sonner toast and then plays a
// collapse/slide-away transition before the node leaves the tree. Ownership is
// keyed on the Payload MEMBER id (resolved from /api/comments GET) — the client
// session only exposes the Better Auth user id, a different id space.
import { useEffect, useState } from 'react'
import { Section, H2, UL, LI, Div, Span, P } from '@expo/html-elements'
import { Pressable, TextInput } from 'react-native'
import { SolitoImage } from 'solito/image'
import { toast } from 'sonner'
import { getSession } from '@dvnt/app/lib/auth-client'
import type { CommentNode } from '@/lib/comments'

const ACCENT = '#FF5BFC'

// authorMember can be a populated object or a bare relationship id (fresh
// optimistic inserts) — normalize to a string id either way.
const authorMemberId = (node: CommentNode): string | undefined => {
  const a = node.authorMember as any
  if (a == null) return undefined
  return String(typeof a === 'object' ? a.id : a)
}

export function Comments({
  postId,
  initial,
  accessToken: tokenProp,
  viewerId: viewerProp,
}: {
  postId: string
  initial: CommentNode[]
  accessToken?: string
  viewerId?: string
}) {
  const [tree, setTree] = useState<CommentNode[]>(initial)
  // The post page renders on the server and can't read the Better Auth session,
  // so resolve the token + viewer client-side. Without this, `authed` was always
  // false and the comment form never appeared / submitted. We also resolve the
  // viewer's MEMBER id from /api/comments so edit/delete affordances show on the
  // viewer's own comments.
  const [accessToken, setAccessToken] = useState<string | undefined>(tokenProp)
  const [viewerId, setViewerId] = useState<string | undefined>(viewerProp)
  useEffect(() => {
    let alive = true
    getSession()
      .then((res: any) => {
        if (!alive) return
        const token = res?.data?.session?.token ?? undefined
        setAccessToken(token)
        if (!token) return
        fetch('/api/comments', { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => alive && d?.memberId && setViewerId(String(d.memberId)))
          .catch(() => {})
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const authed = Boolean(accessToken)

  const addLocal = (node: any, parentId?: string) => {
    const newNode: CommentNode = { ...node, children: [] }
    if (!parentId) {
      setTree((t) => [...t, newNode])
      return
    }
    const insert = (nodes: CommentNode[]): CommentNode[] =>
      nodes.map((n) =>
        n.id === parentId ? { ...n, children: [...n.children, newNode] } : { ...n, children: insert(n.children) },
      )
    setTree((t) => insert(t))
  }

  const removeLocal = (id: string) => {
    const prune = (nodes: CommentNode[]): CommentNode[] =>
      nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: prune(n.children) }))
    setTree((t) => prune(t))
  }

  const editLocal = (id: string, body: string, editedAt: string) => {
    const apply = (nodes: CommentNode[]): CommentNode[] =>
      nodes.map((n) => (n.id === id ? { ...n, body, editedAt } : { ...n, children: apply(n.children) }))
    setTree((t) => apply(t))
  }

  return (
    <Section style={wrap as any}>
      <H2 style={heading as any}>Comments</H2>
      {authed ? (
        <CommentForm postId={postId} accessToken={accessToken!} onAdded={(c) => addLocal(c)} />
      ) : (
        <P style={signin as any}>Sign in to the DVNT app to join the conversation.</P>
      )}
      <UL style={list as any}>
        {tree.map((c) => (
          <CommentItem
            key={c.id}
            node={c}
            postId={postId}
            accessToken={accessToken}
            viewerId={viewerId}
            onReply={addLocal}
            onRemove={removeLocal}
            onEdit={editLocal}
          />
        ))}
        {tree.length === 0 && (
          <LI style={{ listStyle: 'none' } as any}>
            <Span style={{ color: 'rgba(245,245,247,0.4)', fontSize: 14 } as any}>Be the first to comment.</Span>
          </LI>
        )}
      </UL>
    </Section>
  )
}

function CommentItem({
  node,
  postId,
  accessToken,
  viewerId,
  onReply,
  onRemove,
  onEdit,
}: {
  node: CommentNode
  postId: string
  accessToken?: string
  viewerId?: string
  onReply: (c: any, parentId?: string) => void
  onRemove: (id: string) => void
  onEdit: (id: string, body: string, editedAt: string) => void
}) {
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const author = typeof node.authorMember === 'object' ? node.authorMember : { username: 'Member', avatarUrl: undefined }
  const mine = Boolean(accessToken && viewerId && authorMemberId(node) === viewerId)

  const confirmDelete = () => {
    if (!accessToken || deleting) return
    toast('Delete this comment?', {
      description: 'This permanently removes your comment.',
      duration: 8000,
      action: { label: 'Delete', onClick: () => runDelete() },
      cancel: { label: 'Cancel', onClick: () => {} } as any,
    })
  }

  const runDelete = async () => {
    if (!accessToken) return
    const res = await fetch('/api/comments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ commentId: node.id }),
    })
    if (!res.ok) {
      toast.error("Couldn't delete the comment. Try again.")
      return
    }
    // Play the collapse/slide-away, then drop the node once it has animated out.
    setDeleting(true)
    toast.success('Comment deleted')
    setTimeout(() => onRemove(node.id), COLLAPSE_MS)
  }

  return (
    <LI style={[item, deleting && itemLeaving] as any} aria-hidden={deleting}>
      <Div style={row as any}>
        {'avatarUrl' in author && author.avatarUrl ? (
          <Div style={avatarBox as any}>
            <SolitoImage src={author.avatarUrl} alt="" width={26} height={26} style={{ objectFit: 'cover' }} />
          </Div>
        ) : (
          <Div style={avatarFallback as any}>
            <Span style={avatarFallbackText as any}>{author.username?.slice(0, 2).toUpperCase()}</Span>
          </Div>
        )}
        <Span style={{ fontSize: 14, fontWeight: '600', color: '#FAFAF9' } as any}>{author.username}</Span>
        {node.shadowed && mine && <Span style={{ fontSize: 11, color: '#facc15' } as any}>pending review</Span>}
        <Span style={{ fontSize: 12, color: 'rgba(245,245,247,0.4)' } as any}>{new Date(node.createdAt).toLocaleDateString()}</Span>
        {node.editedAt && <Span style={{ fontSize: 12, color: 'rgba(245,245,247,0.3)' } as any}>· edited</Span>}
      </Div>

      {editing ? (
        <EditForm
          initialBody={node.body}
          accessToken={accessToken!}
          commentId={node.id}
          onCancel={() => setEditing(false)}
          onSaved={(body, editedAt) => {
            onEdit(node.id, body, editedAt)
            setEditing(false)
          }}
        />
      ) : (
        <P style={body as any}>{node.body}</P>
      )}

      {!editing && (
        <Div style={actions as any}>
          {accessToken && (
            <Pressable onPress={() => setReplying((r) => !r)}>
              <Span style={linkText as any}>Reply</Span>
            </Pressable>
          )}
          {mine && (
            <Pressable onPress={() => setEditing(true)}>
              <Span style={linkText as any}>Edit</Span>
            </Pressable>
          )}
          {mine && (
            <Pressable onPress={confirmDelete}>
              <Span style={[linkText, { color: '#fca5a5' }] as any}>Delete</Span>
            </Pressable>
          )}
          {accessToken && !mine && (
            <ReportButton
              commentId={node.id}
              reportedMemberId={authorMemberId(node) ?? ''}
              accessToken={accessToken}
            />
          )}
        </Div>
      )}

      {replying && accessToken && (
        <Div style={{ marginTop: 12 } as any}>
          <CommentForm
            postId={postId}
            parentId={node.id}
            accessToken={accessToken}
            onAdded={(c) => {
              onReply(c, node.id)
              setReplying(false)
            }}
          />
        </Div>
      )}
      {node.children.length > 0 && (
        <UL style={childList as any}>
          {node.children.map((child) => (
            <CommentItem
              key={child.id}
              node={child}
              postId={postId}
              accessToken={accessToken}
              viewerId={viewerId}
              onReply={onReply}
              onRemove={onRemove}
              onEdit={onEdit}
            />
          ))}
        </UL>
      )}
    </LI>
  )
}

function CommentForm({
  postId,
  parentId,
  accessToken,
  onAdded,
}: {
  postId: string
  parentId?: string
  accessToken: string
  onAdded: (c: any) => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!body.trim()) return
    setBusy(true)
    setErr('')
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ postId, parentId, body }),
    })
    setBusy(false)
    if (res.status === 403) return setErr("You can't comment right now.")
    if (!res.ok) return setErr('Something went wrong.')
    const { comment } = await res.json()
    onAdded(comment)
    setBody('')
  }

  return (
    <Div style={{ marginTop: 16 } as any}>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        numberOfLines={3}
        maxLength={4000}
        placeholder={parentId ? 'Write a reply…' : 'Add a comment…'}
        placeholderTextColor="rgba(245,245,247,0.4)"
        style={textarea as any}
      />
      {!!err && <P style={{ marginTop: 4, fontSize: 12, color: '#fca5a5' } as any}>{err}</P>}
      <Pressable onPress={submit} disabled={busy || !body.trim()} style={[primaryBtn, (busy || !body.trim()) && { opacity: 0.4 }] as any}>
        <Span style={{ color: '#0a0a14', fontSize: 14, fontWeight: '700' } as any}>{busy ? 'Posting…' : parentId ? 'Reply' : 'Comment'}</Span>
      </Pressable>
    </Div>
  )
}

// Inline edit form — cross-fades in over the comment body. Saves via PATCH and
// hands the new body back so the tree updates in place (no refetch).
function EditForm({
  initialBody,
  commentId,
  accessToken,
  onCancel,
  onSaved,
}: {
  initialBody: string
  commentId: string
  accessToken: string
  onCancel: () => void
  onSaved: (body: string, editedAt: string) => void
}) {
  const [body, setBody] = useState(initialBody)
  const [busy, setBusy] = useState(false)
  const [appear, setAppear] = useState(false)
  useEffect(() => setAppear(true), [])

  const dirty = body.trim() && body.trim() !== initialBody.trim()

  const save = async () => {
    if (!dirty || busy) return
    setBusy(true)
    const res = await fetch('/api/comments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ commentId, body }),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error("Couldn't save your edit. Try again.")
      return
    }
    const { comment } = await res.json().catch(() => ({}))
    onSaved(body.trim(), comment?.editedAt ?? new Date().toISOString())
    toast.success('Comment updated')
  }

  return (
    <Div style={[editWrap, appear ? editWrapShown : editWrapHidden] as any}>
      <TextInput
        value={body}
        onChangeText={setBody}
        multiline
        numberOfLines={3}
        maxLength={4000}
        autoFocus
        placeholder="Edit your comment…"
        placeholderTextColor="rgba(245,245,247,0.4)"
        style={textarea as any}
      />
      <Div style={editActions as any}>
        <Pressable onPress={save} disabled={!dirty || busy} style={[primaryBtn, { marginTop: 0 }, (!dirty || busy) && { opacity: 0.4 }] as any}>
          <Span style={{ color: '#0a0a14', fontSize: 14, fontWeight: '700' } as any}>{busy ? 'Saving…' : 'Save'}</Span>
        </Pressable>
        <Pressable onPress={onCancel} disabled={busy} style={ghostBtn as any}>
          <Span style={{ color: 'rgba(245,245,247,0.7)', fontSize: 14, fontWeight: '600' } as any}>Cancel</Span>
        </Pressable>
      </Div>
    </Div>
  )
}

function ReportButton({ commentId, reportedMemberId, accessToken }: { commentId: string; reportedMemberId: string; accessToken: string }) {
  const [done, setDone] = useState(false)
  const report = async () => {
    const reason = typeof window !== 'undefined' ? window.prompt('Why are you reporting this comment?') ?? '' : ''
    const res = await fetch('/api/comments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ commentId, reportedMemberId, reason }),
    })
    if (res.ok) setDone(true)
  }
  return (
    <Pressable onPress={report} disabled={done}>
      <Span style={[linkText, { color: done ? 'rgba(245,245,247,0.4)' : '#fca5a5' }] as any}>{done ? 'Reported' : 'Report'}</Span>
    </Pressable>
  )
}

// ── DVNT design-language styles (RN/web style objects) ───────────────────────
const COLLAPSE_MS = 260
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

const wrap = { marginTop: 64, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 40 }
const heading = { fontSize: 20, fontWeight: '700', color: '#FAFAF9', letterSpacing: '-0.01em' }
const signin = { marginTop: 16, fontSize: 14, color: 'rgba(245,245,247,0.55)' }
const list = { marginTop: 28, padding: 0, gap: 18, listStyle: 'none' }
const childList = { marginTop: 16, padding: 0, gap: 14, listStyle: 'none' }
// Base item carries the transition so both edit cross-fade and delete collapse
// animate. `overflow: hidden` lets max-height collapse cleanly close the gap.
const item = {
  borderLeftWidth: 2,
  borderLeftColor: `${ACCENT}55`,
  paddingLeft: 16,
  listStyle: 'none',
  overflow: 'hidden',
  maxHeight: 4000,
  transitionProperty: 'opacity, max-height, transform, padding',
  transitionDuration: `${COLLAPSE_MS}ms`,
  transitionTimingFunction: EASE,
}
const itemLeaving = {
  opacity: 0,
  maxHeight: 0,
  paddingTop: 0,
  paddingBottom: 0,
  transform: [{ translateX: -12 }],
}
const row = { flexDirection: 'row', alignItems: 'center', gap: 10 }
const body = { marginTop: 8, color: 'rgba(245,245,247,0.85)', fontSize: 15, lineHeight: 24 }
const actions = { marginTop: 8, flexDirection: 'row', gap: 16 }
const linkText = { color: 'rgba(245,245,247,0.55)', fontSize: 12 }
// Avatars in DVNT are ALWAYS rounded squares — never circles.
const avatarBox = { width: 26, height: 26, borderRadius: 7, overflow: 'hidden' }
const avatarFallback = { width: 26, height: 26, borderRadius: 7, backgroundColor: '#8A40CF', alignItems: 'center', justifyContent: 'center' }
const avatarFallbackText = { color: '#fff', fontSize: 10, fontWeight: '700' }
const textarea = {
  width: '100%',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.12)',
  backgroundColor: 'rgba(8,10,20,0.6)',
  padding: 12,
  fontSize: 14,
  color: '#FAFAF9',
  minHeight: 80,
}
const primaryBtn = { marginTop: 8, alignSelf: 'flex-start', borderRadius: 12, backgroundColor: ACCENT, paddingVertical: 9, paddingHorizontal: 18 }
const ghostBtn = { borderRadius: 12, paddingVertical: 9, paddingHorizontal: 16, alignSelf: 'flex-start' }
// Edit form cross-fade: starts slightly down + transparent, settles into place.
const editWrap = {
  marginTop: 8,
  transitionProperty: 'opacity, transform',
  transitionDuration: '180ms',
  transitionTimingFunction: EASE,
}
const editWrapHidden = { opacity: 0, transform: [{ translateY: 4 }] }
const editWrapShown = { opacity: 1, transform: [{ translateY: 0 }] }
const editActions = { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }
