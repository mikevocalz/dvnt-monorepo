/**
 * Populate the CMS from the live app data — runs the SAME /app/sync handler the
 * admin button uses, from the CLI, so the Payload collections (members, events,
 * tickets) get filled without the deployed serverless endpoint or an admin login.
 *
 *   pnpm --filter web-vite sync:app
 *
 * IMPORTANT: web-vite's DATABASE_URI is the LOCAL dev postgres, but the deployed
 * CMS reads the SUPABASE `payload` schema. So we point Payload's write target at
 * the Supabase connection (APP_DATABASE_URL — same database, `payload` schema)
 * BEFORE loading the config, and force PAYLOAD_PUSH off (true forces a schema
 * alter on init that fails on the existing enums). Override the target with
 * SYNC_TARGET_DATABASE_URI if you really want a different DB (e.g. local).
 */
import 'dotenv/config'

process.env.DATABASE_URI =
  process.env.SYNC_TARGET_DATABASE_URI ||
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URI
process.env.PAYLOAD_PUSH = 'false'

async function main() {
  // Dynamic imports so the env overrides above land before payload.config (which
  // reads DATABASE_URI at module-eval time) is loaded.
  const { getPayload } = await import('payload')
  const { default: config } = await import('../src/payload.config')
  const { appSyncEndpoint } = await import('@dvnt/cms/endpoints/appData')

  const payload = await getPayload({ config })
  console.log('Syncing app → CMS (Supabase payload schema) …')
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
