import type { Pool } from 'pg'
let pool: Pool | undefined
async function photoPool() {
  if (!process.env.APP_DATABASE_URL) return null
  if (!pool) {
    const { Pool } = await import('pg')
    pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2,
      ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 1500,
      statement_timeout: 1500, query_timeout: 2000, idleTimeoutMillis: 30000 })
  }
  return pool
}

export type StaffPhotoAccount = { email?: string | null; avatarUrl?: string | null }
export type AppPhotoRow = { avatar_id: number | null; url: string | null }
export type PhotoLookup = (email: string) => Promise<AppPhotoRow[] | null>
export function safePhotoURL(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { return ['http:', 'https:'].includes(new URL(value).protocol) ? value : null } catch { return null }
}
const lookupAppPhoto: PhotoLookup = async email => {
  const pool = await photoPool()
  if (!pool) return null
  // Same verified account bridge as staff SSO. Never arbitrarily pick one of
  // several matching app identities. No email or account record is returned.
  const result = await pool.query(`select u.avatar_id, m.url from public.users u
    left join public.media m on m.id = u.avatar_id
    where lower(u.email) = lower($1) limit 2`, [email])
  return result.rows
}
export async function resolveStaffPhoto(account: StaffPhotoAccount, lookup: PhotoLookup = lookupAppPhoto): Promise<string | null> {
  const fallback = safePhotoURL(account.avatarUrl)
  if (!account.email) return fallback
  try {
    const rows = await lookup(account.email)
    if (!rows || rows.length !== 1) return fallback
    // An intentionally removed app avatar must not resurrect a stale CMS copy.
    if (rows[0].avatar_id === null) return null
    return safePhotoURL(rows[0].url) ?? fallback
  } catch { return fallback }
}

export async function resolveStaffPhotos(accounts: StaffPhotoAccount[]): Promise<Array<string | null>> {
  try {
    const db = await photoPool()
    if (!db) return accounts.map(account => safePhotoURL(account.avatarUrl))
    const emails = [...new Set(accounts.flatMap(account => account.email ? [account.email.toLowerCase()] : []))]
    if (!emails.length) return accounts.map(account => safePhotoURL(account.avatarUrl))
    const { rows } = await db.query(`select lower(u.email) as email, u.avatar_id, m.url from public.users u
      left join public.media m on m.id = u.avatar_id where lower(u.email) = any($1::text[])`, [emails])
    return Promise.all(accounts.map(account => resolveStaffPhoto(account, async email => rows.filter(row => row.email === email.toLowerCase()))))
  } catch { return accounts.map(account => safePhotoURL(account.avatarUrl)) }
}
