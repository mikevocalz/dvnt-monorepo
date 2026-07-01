// verifyAppUser — resolve a Better Auth session token to a DVNT user
// (public.users.id + email). Mirror of verifyAppSession (which resolves to a
// Payload member id for blog comments) but for payment / entitlement flows.
//
// Failure mode defended against: returning a member id from verifyAppSession
// and then trying to use it as a user id would silently bind a Stripe customer
// to the wrong principal (I1 violation). This helper resolves to the
// authoritative public.users.id.

import pg from 'pg'

let pool: any = null
function getPool(): any {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.APP_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    })
  }
  return pool
}

export type AppUser = { id: string; email: string | null }

export async function verifyAppUser(accessToken?: string): Promise<AppUser | null> {
  if (!accessToken || !process.env.APP_DATABASE_URL) return null
  const token = accessToken.split('.')[0]
  try {
    const { rows } = await getPool().query(
      `select u.id, u.email
         from public.session s
         join public.users u on u.auth_id = s."userId"
        where s.token = $1 and s."expiresAt" > now()
        limit 1`,
      [token],
    )
    if (!rows[0]) return null
    return { id: String(rows[0].id), email: rows[0].email ?? null }
  } catch {
    return null
  }
}

/** Return the Postgres pool so route handlers can issue payment-related
 *  queries (stripe_customers upsert, membership_plans lookup) without
 *  spinning up a second connection pool. */
export function getAppDbPool(): any {
  return getPool()
}
