'use client'
// components/Comments — threaded blog comments in the DVNT design language,
// built from @expo/html-elements (semantic DOM) + solito/image + react-native
// primitives for the interactive bits. No raw HTML tags. Rounded-square avatars
// (the DVNT rule — never circles).
import { useState } from 'react'
import { Section, H2, UL, LI, Div, Span, P } from '@expo/html-elements'
import { Pressable, TextInput } from 'react-native'
import { SolitoImage } from 'solito/image'
import type { CommentNode } from '@/lib/comments'

const ACCENT = '#FF5BFC'

export function Comments({
  postId,
  initial,
  accessToken,
  viewerId,
}: {
  postId: string
  initial: CommentNode[]
  accessToken?: string
  viewerId?: string
}) {
  const [tree, setTree] = useState<CommentNode[]>(initial)
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
          <CommentItem key={c.id} node={c} postId={postId} accessToken={accessToken} viewerId={viewerId} onReply={addLocal} />
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
}: {
  node: CommentNode
  postId: string
  accessToken?: string
  viewerId?: string
  onReply: (c: any, parentId?: string) => void
}) {
  const [replying, setReplying] = useState(false)
  const author = typeof node.authorMember === 'object' ? node.authorMember : { username: 'Member', avatarUrl: undefined }
  const mine = typeof node.authorMember === 'object' && node.authorMember.id === viewerId

  return (
    <LI style={item as any}>
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
      </Div>
      <P style={body as any}>{node.body}</P>
      <Div style={actions as any}>
        {accessToken && (
          <Pressable onPress={() => setReplying((r) => !r)}>
            <Span style={linkText as any}>Reply</Span>
          </Pressable>
        )}
        {accessToken && !mine && (
          <ReportButton
            commentId={node.id}
            reportedMemberId={typeof node.authorMember === 'object' ? node.authorMember.id : node.authorMember}
            accessToken={accessToken}
          />
        )}
      </Div>
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
            <CommentItem key={child.id} node={child} postId={postId} accessToken={accessToken} viewerId={viewerId} onReply={onReply} />
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
const wrap = { marginTop: 64, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 40 }
const heading = { fontSize: 20, fontWeight: '700', color: '#FAFAF9', letterSpacing: '-0.01em' }
const signin = { marginTop: 16, fontSize: 14, color: 'rgba(245,245,247,0.55)' }
const list = { marginTop: 28, padding: 0, gap: 18, listStyle: 'none' }
const childList = { marginTop: 16, padding: 0, gap: 14, listStyle: 'none' }
const item = { borderLeftWidth: 2, borderLeftColor: `${ACCENT}55`, paddingLeft: 16, listStyle: 'none' }
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
