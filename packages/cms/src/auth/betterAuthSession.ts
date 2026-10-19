/** Read-only validation shared by Payload SSO and the admin login recovery gate. */
let pool: any = null
export async function appPool(): Promise<any> {
  const url = process.env.APP_DATABASE_URL
  if (!url) return null
  if (!pool) {
    const pg: any = await import('pg')
    const Pool = pg.default?.Pool ?? pg.Pool
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

export function betterAuthTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === '__Secure-better-auth.session_token' || name === 'better-auth.session_token') {
      try { return decodeURIComponent(rest.join('=')).split('.')[0] || null } catch { return null }
    }
  }
  return null
}

type Session = { userId: string; expiresAt: string | Date }
type FindSession = (token: string) => Promise<Session | undefined>

async function findSession(token: string): Promise<Session | undefined> {
  const p = await appPool()
  if (!p) throw new Error('App session validation is unavailable')
  const result = await p.query(
    `select "userId", "expiresAt" from public.session where token = $1 order by "createdAt" desc limit 1`,
    [token],
  )
  return result.rows[0]
}

export async function readBetterAuthSession(
  cookieHeader: string | null,
  lookup: FindSession = findSession,
  now = Date.now(),
): Promise<Session | null> {
  const token = betterAuthTokenFromCookie(cookieHeader)
  if (!token) return null
  const session = await lookup(token)
  const expires = session ? new Date(session.expiresAt).getTime() : NaN
  return session?.userId && Number.isFinite(expires) && expires > now ? session : null
}
