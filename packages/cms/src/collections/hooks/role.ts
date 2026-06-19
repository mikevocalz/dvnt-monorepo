// src/collections/hooks/role.ts
// When a member's `role` is changed in the admin, write it back to the app's
// public.users.role so it takes effect in the app immediately (and, paired with
// the Better-Auth SSO strategy, grants/revokes CMS access). Members link to the
// app user by `appUserId` = public.users.id (the integer PK, as text).
import type { CollectionAfterChangeHook } from 'payload'
import { forceSuperAdminByEmail } from '../../access/roles'

// App role (public.enum_users_role / Members.role) → CMS role (admin_users).
// Basic / anything else → null = not staff (revoke console access).
const CMS_ROLE_BY_MEMBER: Record<string, 'super_admin' | 'admin' | 'moderator'> = {
  'Super-Admin': 'super_admin',
  Admin: 'admin',
  Moderator: 'moderator',
}
const randomSecret = () =>
  Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('')

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

  const appUserId = doc?.appUserId

  // 1) Write the app role back to public.users (the SSO source of truth) — ONLY
  //    when the role actually changed, to avoid needless writes on unrelated
  //    profile/status edits.
  if (doc?.role && doc.role !== previousDoc?.role && appUserId) {
    const p = await appPool()
    if (!p) {
      req.payload?.logger?.warn?.('[role] APP_DATABASE_URL not set — cannot write role back')
    } else {
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
    }
  }

  // 2) Reconcile the admin_users seat on EVERY save (idempotent), NOT only when
  //    the role changed. This is the fix for "I granted them but they don't show
  //    in Admin Users": a member appointed BEFORE this hook existed (or whose
  //    seat was never created) gets it created simply by re-saving them — no role
  //    change required. The seat shows in the Admin Users list immediately
  //    (instead of waiting for the SSO strategy to lazily provision it on first
  //    /admin login). A member at Basic (cmsRole null) has any seat removed.
  try {
    const email = String(doc.email || '').toLowerCase()
    if (email) {
      const cmsRole = forceSuperAdminByEmail(email) ?? CMS_ROLE_BY_MEMBER[String(doc.role)] ?? null
      const found = await req.payload.find({
        collection: 'admin-users', where: { email: { equals: email } }, limit: 1, overrideAccess: true,
      })
      if (cmsRole) {
        const data = { role: cmsRole, name: doc.username || email, avatarUrl: doc.avatarUrl || undefined }
        if (found.docs[0]) {
          await req.payload.update({ collection: 'admin-users', id: found.docs[0].id, data, overrideAccess: true })
        } else {
          await req.payload.create({
            collection: 'admin-users',
            data: { email, ...data, password: randomSecret() } as any,
            overrideAccess: true,
          })
        }
        req.payload?.logger?.info?.(`[role] admin_users seat for ${email} -> ${cmsRole}`)
      } else if (found.docs[0]) {
        await req.payload.delete({ collection: 'admin-users', id: found.docs[0].id, overrideAccess: true })
        req.payload?.logger?.info?.(`[role] revoked admin_users seat for ${email}`)
      }
    }
  } catch (e: any) {
    req.payload?.logger?.error?.(`[role] admin_users sync failed: ${e?.message}`)
  }
  return doc
}
