// scripts/promote-admin.ts — grant an existing APP user (public.users) a console
// role (super_admin | admin | moderator). Copies their Payload-format hash/salt
// across, so they sign in to the admin with the SAME password they already use
// in the app — no reset, no new password.
//
//   EMAIL=zeus@example.com ROLE=moderator pnpm --filter web-vite exec tsx scripts/promote-admin.ts
//   (ROLE defaults to moderator; EMAIL or USERNAME accepted)
import 'dotenv/config'
import pg from 'pg'

const PINNED = ['mike@deviant.live', 'devianteventsdc@gmail.com', 'mikefacesny@gmail.com']
const ROLES = ['super_admin', 'admin', 'moderator']

async function run() {
  const ident = (process.env.EMAIL || process.env.USERNAME || '').trim().toLowerCase()
  let role = (process.env.ROLE || 'moderator').trim()
  if (!ident) throw new Error('Set EMAIL=<app user email or username>')
  if (!ROLES.includes(role)) throw new Error(`ROLE must be one of ${ROLES.join(', ')}`)

  const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2, ssl: { rejectUnauthorized: false } })
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 })

  const r = await app.query(
    `select email, username, first_name, last_name, hash, salt
       from public.users
      where lower(email) = $1 or lower(username) = $1
      limit 1`,
    [ident],
  )
  const u = r.rows[0]
  if (!u) throw new Error(`No app user found for "${ident}"`)
  if (!u.hash || !u.salt) throw new Error(`App user "${ident}" has no password set (social-only login?) — can't reuse a password.`)

  // Pinned canonical accounts are always super_admin.
  if (PINNED.includes(String(u.email).toLowerCase())) role = 'super_admin'
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.email

  const existing = await admin.query(`select id from payload.admin_users where lower(email) = $1 limit 1`, [String(u.email).toLowerCase()])
  if (existing.rows[0]) {
    await admin.query(
      `update payload.admin_users set role=$1, name=$2, hash=$3, salt=$4, updated_at=now() where id=$5`,
      [role, name, u.hash, u.salt, existing.rows[0].id],
    )
    console.log(`updated admin: ${u.email} → ${role} (existing app password reused)`)
  } else {
    await admin.query(
      `insert into payload.admin_users (email, role, name, hash, salt, created_at, updated_at)
       values ($1, $2, $3, $4, $5, now(), now())`,
      [u.email, role, name, u.hash, u.salt],
    )
    console.log(`created admin: ${u.email} → ${role} (signs in with their existing app password)`)
  }

  await app.end()
  await admin.end()
  process.exit(0)
}
run().catch((e) => { console.error('promote failed:', e.message); process.exit(1) })
