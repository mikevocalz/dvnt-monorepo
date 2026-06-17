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
