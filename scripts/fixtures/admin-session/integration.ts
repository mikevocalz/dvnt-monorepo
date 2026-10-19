import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { betterAuth } from 'better-auth'
import { createAuthClient } from 'better-auth/client'
import { getMigrations } from 'better-auth/db/migration'
import { buildConfig, getPayload, handleEndpoints } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { AdminUsers } from '../../../packages/cms/src/collections/AdminUsers'
import { appPool, readBetterAuthSession, betterAuthTokenFromCookie } from '../../../packages/cms/src/auth/betterAuthSession'
import { resolveAdminEntry } from '../../../packages/app/lib/auth/admin-entry'
import { createAdminSignOut } from '../../../apps/web/src/dashboard/lib/admin-sign-out'

// This child receives only its explicitly validated fixture URL. Block outbound
// socket/fetch destinations before any server or database initialization.
const dbURL = new URL(process.env.APP_DATABASE_URL!)
assert.equal(dbURL.hostname, '127.0.0.1')
assert.equal(dbURL.pathname, '/dvnt_admin_auth_fixture')
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args: any[]) {
  const options = typeof args[0] === 'object' ? args[0] : { host: args[1] }
  const host = options.host ?? 'localhost'
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'Fixture forbids outbound sockets')
  return connect.apply(this, args as any)
} as any
const realFetch = globalThis.fetch
let origin = ''
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert.equal(url.origin, origin, 'Fixture forbids external HTTP')
  return realFetch(input, init)
}
const db = new Pool({ connectionString: dbURL.href, ssl: { rejectUnauthorized: false } })
let payload: Awaited<ReturnType<typeof getPayload>> | undefined
let server: http.Server | undefined
const results: string[] = []
const pass = (message: string) => { results.push(message); console.log('PASS: ' + message) }
try {
  const tables = await db.query("select count(*)::int as count from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")
  assert.equal(tables.rows[0].count, 0, 'Refuse to initialize a database that is not empty')
  let dispatch: (request: Request) => Promise<Response>
  server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const response = await dispatch(new Request(origin + req.url, { method: req.method,
        headers: req.headers as any, ...(body.length ? { body } : {}) }))
      res.statusCode = response.status
      response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value) })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) res.setHeader('set-cookie', cookies)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) { console.error('Fixture handler error', error); res.statusCode = 500; res.end('Fixture handler failed') }
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  const authOptions = { database: db, secret: randomBytes(32).toString('hex'), baseURL: origin,
    emailAndPassword: { enabled: true }, telemetry: { enabled: false }, trustedOrigins: [origin] }
  await (await getMigrations(authOptions)).runMigrations()
  const auth = betterAuth(authOptions)
  await db.query('create table public.users (id serial primary key, auth_id text unique not null, email text not null, username text not null, role text not null)')
  const config = await buildConfig({
    telemetry: false, secret: randomBytes(32).toString('hex'), serverURL: origin,
    admin: { user: 'admin-users' }, routes: { api: '/payload-api' }, csrf: [origin], cors: [origin],
    collections: [AdminUsers],
    db: postgresAdapter({ pool: { connectionString: dbURL.href, ssl: { rejectUnauthorized: false } },
      schemaName: 'payload_fixture', push: true }),
  })
  payload = await getPayload({ config })
  dispatch = request => new URL(request.url).pathname.startsWith('/api/auth/')
    ? auth.handler(request) : handleEndpoints({ config, request })
  const password = 'fixture-only-' + randomBytes(16).toString('hex')
  await payload.create({ collection: 'admin-users', overrideAccess: true,
    data: { email: 'local-admin@example.invalid', password, name: 'Local fixture', role: 'admin' } })

  function browser() {
    const jar = new Map<string, string>()
    const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    const fetchWithCookies: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      assert.equal(new URL(url).origin, origin)
      const headers = new Headers(init?.headers)
      headers.set('origin', origin)
      if (jar.size) headers.set('cookie', cookie())
      const response = await fetch(url, { ...init, headers, redirect: 'manual', cache: 'no-store' })
      for (const entry of response.headers.getSetCookie()) {
        const pair = entry.split(';', 1)[0]
        const index = pair.indexOf('=')
        const name = pair.slice(0, index), value = pair.slice(index + 1)
        if (!value || /max-age=0/i.test(entry)) jar.delete(name)
        else jar.set(name, value)
      }
      return response
    }
    const client = createAuthClient({ baseURL: origin, fetchOptions: { customFetchImpl: fetchWithCookies } })
    const request = async (path: string, data?: object) => {
      const response = await fetchWithCookies(origin + path, { ...(data ? { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json' } } : {}) })
      const body = await response.json()
      if (!response.ok) throw new Error(`Fixture HTTP ${response.status} at ${path}: ${JSON.stringify(body)}`)
      return body
    }
    const policy = () => resolveAdminEntry({ path: '/admin/collections/posts/fixture', search: { tab: 'content' } }, {
      authenticate: async () => (await payload!.auth({ headers: new Headers({ cookie: cookie(), 'sec-fetch-site': 'none' }) })).user,
      readAppSession: () => readBetterAuthSession(cookie()),
    })
    const logout = createAdminSignOut({ clearLocalState: () => {}, payloadLogout: () => request('/payload-api/admin-users/logout', {}),
      betterAuthSignOut: () => client.signOut(), readPayloadUser: () => request('/payload-api/admin-users/me') })
    return { jar, cookie, client, request, policy, logout }
  }
  const signup = async (role: string, suffix: string) => {
    const b = browser()
    const email = `fixture-${suffix}@example.invalid`
    const result = await b.client.signUp.email({ email, password, name: 'Fixture identity' })
    assert.equal(result.error, null)
    assert.ok(result.data?.user.id)
    await db.query('insert into public.users(auth_id,email,username,role) values($1,$2,$3,$4)', [result.data!.user.id, email, suffix, role])
    assert.ok(b.cookie().includes('better-auth.session_token='), 'Actual auth handler must issue signed cookie')
    return b
  }
  const signedOut = browser()
  assert.equal((await signedOut.request('/payload-api/admin-users/me')).user, null)
  assert.equal(await signedOut.policy(), '/auth/login?returnTo=%2Fadmin%2Fcollections%2Fposts%2Ffixture%3Ftab%3Dcontent')
  pass('real handlers reject anonymous access and preserve deep-link recovery')

  const staff = await signup('Admin', 'staff')
  assert.equal((await staff.request('/payload-api/admin-users/me')).user.role, 'admin')
  assert.equal(await staff.policy(), null)
  const staffToken = betterAuthTokenFromCookie(staff.cookie())!
  await staff.logout()
  assert.equal((await staff.request('/payload-api/admin-users/me')).user, null)
  assert.equal((await db.query('select token from public.session where token=$1', [staffToken])).rowCount, 0)
  pass('actual Better Auth signed cookie grants staff CMS access; coordinated logout revokes its database session')

  const nonstaff = await signup('Basic', 'nonstaff')
  assert.equal((await nonstaff.request('/payload-api/admin-users/me')).user, null)
  assert.equal(await nonstaff.policy(), null, 'Active nonstaff stays subject to Payload denial rather than shared-login loop')
  assert.equal((await payload.find({ collection: 'admin-users', where: { email: { equals: 'fixture-nonstaff@example.invalid' } } })).docs.length, 0)
  pass('nonstaff signed cookie never provisions or authenticates an admin')

  for (const mode of ['revoked', 'expired']) {
    const b = await signup('Admin', mode)
    const token = betterAuthTokenFromCookie(b.cookie())!
    if (mode === 'revoked') await db.query('delete from public.session where token=$1', [token])
    else await db.query('update public.session set "expiresAt"=now()-interval \'1 minute\' where token=$1', [token])
    assert.equal((await b.request('/payload-api/admin-users/me')).user, null)
    assert.ok((await b.policy())?.startsWith('/auth/login?returnTo='))
  }
  pass('real revoked/expired database sessions recover despite stale signed cookies')

  const local = browser()
  await local.request('/payload-api/admin-users/login', { email: 'local-admin@example.invalid', password })
  assert.ok(local.cookie().includes('payload-token='))
  assert.equal((await local.request('/payload-api/admin-users/me')).user.email, 'local-admin@example.invalid')
  assert.equal(await local.policy(), null)
  assert.equal((await payload.auth({ headers: new Headers({ cookie: local.cookie(), 'sec-fetch-site': 'cross-site' }) })).user, null)
  const oldLocalCookie = local.cookie()
  await local.logout()
  const replay = browser(); for (const pair of oldLocalCookie.split('; ')) { const i = pair.indexOf('='); replay.jar.set(pair.slice(0, i), pair.slice(i + 1)) }
  assert.equal((await replay.request('/payload-api/admin-users/me')).user, null, 'Old local session must be revoked, not just hidden by a cleared cookie')
  pass('actual legacy CMS login remains supported and its server session is revoked by logout')

  // Frozen pre-fix ordering from 9340dbc8. The real custom SSO strategy masks
  // the legacy JWT's session id, so removing its cookie is not server revocation.
  const baseline = await signup('Admin', 'baseline-dual')
  await baseline.request('/payload-api/admin-users/login', { email: 'local-admin@example.invalid', password })
  const baselineToken = baseline.jar.get('payload-token')!
  await baseline.request('/payload-api/admin-users/logout', {})
  assert.equal((await baseline.client.signOut()).data?.success, true)
  const baselineReplay = browser(); baselineReplay.jar.set('payload-token', baselineToken)
  assert.equal((await baselineReplay.request('/payload-api/admin-users/me')).user.email, 'local-admin@example.invalid')
  await baselineReplay.logout()
  pass('frozen Payload-first ordering reproduces a replayable masked local session')

  const dual = await signup('Admin', 'dual')
  await dual.request('/payload-api/admin-users/login', { email: 'local-admin@example.invalid', password })
  const oldDualPayloadCookie = dual.jar.get('payload-token')!
  assert.ok(oldDualPayloadCookie)
  await dual.logout()
  const dualReplay = browser(); dualReplay.jar.set('payload-token', oldDualPayloadCookie)
  assert.equal((await dualReplay.request('/payload-api/admin-users/me')).user, null, 'Dual-session logout must revoke the underlying local Payload session too')
  pass('dual Better Auth + local Payload sessions both revoke at their real server authorities')
  console.log(`${results.length} real HTTP/PostgreSQL integration groups passed; no external accounts or database used`)
} finally {
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve())
  await payload?.destroy()
  await (await appPool())?.end()
  await db.end()
}
