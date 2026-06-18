// src/collections/hooks/role.ts
// When a member's `role` is changed in the admin, write it back to the app's
// public.users.role so it takes effect in the app immediately (and, paired with
// the Better-Auth SSO strategy, grants/revokes CMS access). Members link to the
// app user by `appUserId` = public.users.id (the integer PK, as text).
import type { CollectionAfterChangeHook } from 'payload'

// Lazily-created write pool to the app DB (public schema). Separate from the
// read-only appData pool by design.
let pool: any = null
async function appPool(): Promise<any> {
  const url = process.env.APP_DATABASE_URL
  if (!url) return null
  if (!pool) {
    const pg: any = await import('pg')
    const Pool = pg.default?.Pool ?? pg.Pool
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

// Avatar replace: when a new image is uploaded to the Members `avatarUpload`
// field, copy its URL into public.media and repoint public.users.avatar_id, so
// the app shows the new profile picture. Also refreshes the CMS display URL.
const relId = (v: any): number | undefined => {
  if (v == null) return undefined
  return Number(typeof v === 'object' ? v.id : v)
}

export const onMemberAvatarChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'update') return doc
  if ((context as any)?.skipRoleWriteBack) return doc
  const uploadId = relId((doc as any).avatarUpload)
  const prevUploadId = relId((previousDoc as any)?.avatarUpload)
  if (!uploadId || uploadId === prevUploadId) return doc
  const appUserId = doc?.appUserId
  if (!appUserId) return doc

  // Resolve the uploaded media's URL (populated relation or a lookup).
  let media: any = typeof (doc as any).avatarUpload === 'object' ? (doc as any).avatarUpload : null
  if (!media?.url) {
    media = await req.payload.findByID({ collection: 'media', id: uploadId, overrideAccess: true }).catch(() => null)
  }
  if (!media?.url) return doc
  const origin = (process.env.BLOG_ORIGIN || process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, '')
  const url = /^https?:\/\//.test(media.url) ? media.url : `${origin}${media.url}`

  const p = await appPool()
  if (!p) return doc
  try {
    const ins = await p.query(`insert into public.media (url) values ($1) returning id`, [url])
    const mediaId = ins.rows[0]?.id
    await p.query(`update public.users set avatar_id = $1, updated_at = now() where id = $2`, [mediaId, Number(appUserId)])
    // Refresh the CMS display field directly (same DB, payload schema) — avoids
    // Payload afterChange recursion.
    await p.query(`update payload.members set avatar_url = $1, updated_at = now() where id = $2`, [url, doc.id])
    req.payload?.logger?.info?.(`[member] avatar replaced for users.id=${appUserId} -> media ${mediaId}`)
  } catch (e: any) {
    req.payload?.logger?.error?.(`[member] avatar replace failed for ${appUserId}: ${e?.message}`)
  }
  return doc
}

// Editable profile fields mirrored onto Members → write back to public.users.
// Payload field name → public.users column.
const PROFILE_COLUMNS: Record<string, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  bio: 'bio',
  location: 'location',
  website: 'website',
  gender: 'gender',
}

export const onMemberProfileChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'update') return doc
  // The sync writes these FROM public.users; skip the echo.
  if ((context as any)?.skipRoleWriteBack) return doc
  const appUserId = doc?.appUserId
  if (!appUserId) return doc

  const sets: string[] = []
  const vals: any[] = []
  let i = 1
  for (const [field, col] of Object.entries(PROFILE_COLUMNS)) {
    if ((doc as any)[field] !== (previousDoc as any)?.[field]) {
      sets.push(`${col} = $${i++}`)
      vals.push((doc as any)[field] ?? null)
    }
  }
  if (!sets.length) return doc

  const p = await appPool()
  if (!p) {
    req.payload?.logger?.warn?.('[member] APP_DATABASE_URL not set — cannot write profile back')
    return doc
  }
  vals.push(Number(appUserId))
  try {
    await p.query(
      `update public.users set ${sets.join(', ')}, updated_at = now() where id = $${i}`,
      vals,
    )
    req.payload?.logger?.info?.(`[member] wrote ${sets.length} profile field(s) to users.id=${appUserId}`)
  } catch (e: any) {
    req.payload?.logger?.error?.(`[member] profile write-back failed for ${appUserId}: ${e?.message}`)
  }
  return doc
}

export const onMemberRoleChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'update') return doc
  // The sync sets role FROM public.users.role; skip the echo write-back.
  if ((context as any)?.skipRoleWriteBack) return doc
  if (doc?.role === previousDoc?.role) return doc

  const appUserId = doc?.appUserId
  if (!appUserId || !doc?.role) return doc

  const p = await appPool()
  if (!p) {
    req.payload?.logger?.warn?.('[role] APP_DATABASE_URL not set — cannot write role back')
    return doc
  }
  try {
    await p.query(
      `update public.users
         set role = $1::public.enum_users_role, updated_at = now()
       where id = $2`,
      [doc.role, Number(appUserId)],
    )
    req.payload?.logger?.info?.(`[role] public.users.id=${appUserId} -> ${doc.role}`)
  } catch (e: any) {
    req.payload?.logger?.error?.(`[role] write-back failed for ${appUserId}: ${e?.message}`)
  }
  return doc
}
