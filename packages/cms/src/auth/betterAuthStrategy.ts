// src/auth/betterAuthStrategy.ts
// Payload custom auth strategy that TRUSTS the app's Better Auth session, so an
// app user with a staff role (Super-Admin / Admin / Moderator) lands in /admin
// without a second login. The web app proxies /api/auth through the same origin,
// so the `__Secure-better-auth.session_token` cookie is first-party here.
//
// Flow: read the cookie → validate against public.session → look up
// public.users.role → if staff, find/auto-provision the matching admin-users
// record and authenticate as it. Any failure returns null so the built-in local
// (email+password) strategy still applies — this NEVER blocks normal login.
import type { AuthStrategy } from 'payload'
import { forceSuperAdminByEmail } from '../access/roles'
import { appPool, readBetterAuthSession } from './betterAuthSession'

// App role (public.enum_users_role) → CMS role (admin-users). Basic/unknown → null (not staff).
function toCmsRole(appRole?: string, email?: string): 'super_admin' | 'admin' | 'moderator' | null {
  if (forceSuperAdminByEmail(email)) return 'super_admin'
  switch (appRole) {
    case 'Super-Admin': return 'super_admin'
    case 'Admin': return 'admin'
    case 'Moderator': return 'moderator'
    default: return null
  }
}

const randomSecret = () =>
  Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('')

export const betterAuthStrategy: AuthStrategy = {
  name: 'better-auth-session',
  authenticate: async ({ headers, payload }) => {
    try {
      const s = await readBetterAuthSession(headers.get('cookie'))
      if (!s) return { user: null }
      const p = await appPool()
      if (!p) return { user: null }

      const ur = await p.query(
        `select id, email, username, role from public.users where auth_id = $1 limit 1`,
        [s.userId],
      )
      const u = ur.rows[0]
      if (!u?.email) return { user: null }

      const cmsRole = toCmsRole(u.role, u.email)
      if (!cmsRole) return { user: null } // signed in, but not staff → no admin access

      const found = await payload.find({
        collection: 'admin-users',
        where: { email: { equals: u.email } },
        limit: 1,
        overrideAccess: true,
      })
      let adminUser: any = found.docs[0]
      if (!adminUser) {
        adminUser = await payload.create({
          collection: 'admin-users',
          data: { email: u.email, name: u.username || u.email, role: cmsRole, password: randomSecret() },
          overrideAccess: true,
        })
      } else if (adminUser.role !== cmsRole) {
        adminUser = await payload.update({
          collection: 'admin-users',
          id: adminUser.id,
          data: { role: cmsRole },
          overrideAccess: true,
        })
      }

      return { user: { ...adminUser, collection: 'admin-users' } }
    } catch (e: any) {
      payload?.logger?.error?.(`[sso] better-auth strategy error: ${e?.message}`)
      return { user: null }
    }
  },
}
