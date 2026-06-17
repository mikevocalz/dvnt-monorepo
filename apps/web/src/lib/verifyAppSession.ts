// src/lib/verifyAppSession.ts — verify the DVNT app (Better Auth) session for
// the blog comment endpoints. The app moved from Supabase Auth to Better Auth,
// so we validate the session token directly against public.session, then resolve
// the matching Payload member id (comments.authorMember relates to `members`).
//
// Chain: better-auth token → public.session.userId (auth id)
//        → public.users.id → payload.members.app_user_id → member.id
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

export async function verifyAppSession(accessToken?: string): Promise<{ memberId: string } | null> {
  if (!accessToken || !process.env.APP_DATABASE_URL) return null
  // The session table stores the bare token; a cookie value may carry `.sig`.
  const token = accessToken.split('.')[0]
  try {
    const { rows } = await getPool().query(
      `select m.id as member_id
         from public.session s
         join public.users u on u.auth_id = s."userId"
         join payload.members m on m.app_user_id = u.id::text
        where s.token = $1 and s."expiresAt" > now()
        limit 1`,
      [token],
    )
    if (!rows[0]) return null
    return { memberId: String(rows[0].member_id) }
  } catch {
    return null
  }
}
