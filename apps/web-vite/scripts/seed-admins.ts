// scripts/seed-admins.ts
// Idempotent seed for the two canonical super-admins. Run once after migration:
//   pnpm --filter web-vite seed:admins
// Re-running is safe: it upserts and forces role=super_admin.
//
// NOTE on Better Auth: if staff also authenticate through Better Auth's admin
// plugin (not just Payload's own auth), mirror these two emails as admins there
// too. Payload owns the admin-panel session; Better Auth owns app-user sessions
// (used by the ban → revokeAppSessions path). They are separate session stores.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

const SUPER_ADMINS = [
  { email: 'mike@deviant.live', name: 'Mike' },
  { email: 'devianteventsdc@gmail.com', name: 'Deviant Events DC' },
]

async function run() {
  const payload = await getPayload({ config })
  for (const a of SUPER_ADMINS) {
    const existing = await payload.find({
      collection: 'admin-users',
      where: { email: { equals: a.email } },
      limit: 1,
    })
    if (existing.totalDocs > 0) {
      await payload.update({
        collection: 'admin-users',
        id: existing.docs[0].id,
        data: { role: 'super_admin', name: a.name },
        overrideAccess: true,
      })
      console.log(`pinned super_admin: ${a.email}`)
    } else {
      // A temporary password is set; super-admin resets via the panel's
      // forgot-password flow on first login. Do NOT commit real passwords.
      const tempPassword = `Dvnt!${Math.random().toString(36).slice(2, 12)}`
      await payload.create({
        collection: 'admin-users',
        data: { email: a.email, name: a.name, role: 'super_admin', password: tempPassword },
        overrideAccess: true,
      })
      console.log(`created super_admin: ${a.email}  (temp password: ${tempPassword})`)
    }
  }
  process.exit(0)
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
