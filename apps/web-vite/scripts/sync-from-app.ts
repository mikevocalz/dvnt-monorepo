/**
 * Populate the CMS from the live app data — runs the SAME /app/sync handler the
 * admin button uses, from the CLI, so the Payload collections (members, events,
 * tickets) get filled without the deployed serverless endpoint or an admin
 * login. The handler reads APP_DATABASE_URL itself; we pass a super_admin req +
 * a getPayload() instance. Locally the session pooler connects fine.
 *
 *   pnpm --filter web-vite sync:app
 */
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { appSyncEndpoint } from '@dvnt/cms/endpoints/appData'

async function main() {
  const payload = await getPayload({ config })
  console.log('Syncing app → CMS …')
  // The endpoint handler returns a web Response; mock the minimum it reads.
  const res: any = await (appSyncEndpoint as any).handler({
    user: { role: 'super_admin' },
    payload,
    url: 'http://localhost/payload-api/app/sync',
  })
  const body = await res.json()
  console.log('Result:', JSON.stringify(body, null, 2))
  process.exit(body?.ok ? 0 : 1)
}

main().catch((e) => {
  console.error('[sync-from-app] failed:', e?.message ?? e)
  process.exit(1)
})
