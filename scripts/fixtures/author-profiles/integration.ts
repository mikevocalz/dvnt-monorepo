import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import sharp from 'sharp'
import { buildConfig, getPayload, handleEndpoints } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { AdminUsers } from '../../../packages/cms/src/collections/AdminUsers'
import { Authors } from '../../../packages/cms/src/collections/Authors'
import { Posts } from '../../../packages/cms/src/collections/Posts'
import { Media } from '../../../packages/cms/src/collections/Media'
import { Categories } from '../../../packages/cms/src/collections/Categories'

// Recheck the wrapper's safety boundary in the executable child. No .env files,
// production config, app database, storage adapters or external hooks are used.
const dbURL = new URL(process.env.DVNT_AUTHOR_TEST_DATABASE_URL!)
assert.equal(dbURL.protocol, 'postgresql:')
assert.equal(dbURL.hostname, '127.0.0.1')
assert.equal(dbURL.pathname, '/dvnt_author_fixture')
assert.equal(dbURL.username, 'dvnt_author_fixture')
assert.equal(dbURL.search, '')
assert.equal(dbURL.hash, '')
assert.equal(process.env.APP_DATABASE_URL, undefined)
assert.equal(process.env.DATABASE_URI, undefined)
const connect = net.Socket.prototype.connect
function assertLocalConnection(args: any[]) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  assert.ok(typeof first === 'object' || typeof first === 'number' ||
    (typeof first === 'string' && /^\d+$/.test(first)), 'Fixture forbids Unix socket paths')
  const options = typeof first === 'object' ? first : { host: typeof args[1] === 'string' ? args[1] : 'localhost' }
  assert.ok(options && !options.path, 'Fixture forbids Unix socket paths')
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(options.host ?? 'localhost'), 'Fixture forbids outbound sockets')
}
assert.throws(() => assertLocalConnection([[{ host: 'outside.invalid', port: 443 }]]), /outbound/)
assert.throws(() => assertLocalConnection([443, 'outside.invalid']), /outbound/)
assert.throws(() => assertLocalConnection([[{ path: '/tmp/forbidden.sock' }]]), /Unix socket/)
assert.doesNotThrow(() => assertLocalConnection([[{ host: '127.0.0.1', port: 5432 }]]))
net.Socket.prototype.connect = function (...args: any[]) {
  assertLocalConnection(args)
  return connect.apply(this, args as any)
} as any
const realFetch = globalThis.fetch
let origin = ''
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert.equal(url.origin, origin, 'Fixture forbids external HTTP')
  return realFetch(input, init)
}

const schema = 'payload_author_fixture'
const db = new Pool({ connectionString: dbURL.href })
let payload: Awaited<ReturnType<typeof getPayload>> | undefined
let server: http.Server | undefined
const results: string[] = []
const pass = (message: string) => { results.push(message); console.log('PASS: ' + message) }
const id = (value: any): number => Number(typeof value === 'object' && value !== null ? value.id : value)
const ids = (values: any[]) => values.map(id)
const content = {
  root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [
    { type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [
      { type: 'text', version: 1, text: 'A disposable author profile fixture article.', format: 0, detail: 0, mode: 'normal', style: '' },
    ] },
  ] },
}

try {
  const tables = await db.query("select count(*)::int as count from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")
  assert.equal(tables.rows[0].count, 0, 'Refuse to initialize a database that is not empty')
  let dispatch: (request: Request) => Promise<Response>
  server = http.createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const response = await dispatch(new Request(origin + req.url, {
        method: req.method, headers: req.headers as any, ...(body.length ? { body } : {}),
      }))
      res.statusCode = response.status
      response.headers.forEach((value, name) => { if (name !== 'set-cookie') res.setHeader(name, value) })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) res.setHeader('set-cookie', cookies)
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      console.error('Fixture HTTP handler error', error)
      res.statusCode = 500
      res.end('Fixture HTTP handler failed')
    }
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  let linkRaceID: number | undefined
  let linkRaceArrivals = 0
  let releaseLinkRace: () => void
  const linkRaceGate = new Promise<void>(resolve => { releaseLinkRace = resolve })
  const config = await buildConfig({
    telemetry: false, secret: randomBytes(32).toString('hex'), serverURL: origin,
    admin: { user: 'admin-users' }, routes: { api: '/payload-api' }, csrf: [origin], cors: [origin],
    editor: lexicalEditor(), sharp,
    collections: [AdminUsers, { ...Authors, hooks: { ...Authors.hooks, beforeChange: [
      async (args: any) => {
        if (args.operation === 'update' && args.originalDoc.id === linkRaceID) {
          linkRaceArrivals += 1
          if (linkRaceArrivals === 2) releaseLinkRace()
          await linkRaceGate
        }
        return args.data
      }, ...Authors.hooks!.beforeChange!] } }, Posts, Media, Categories, {
      // Posts has an event callout relationship. Keep its target valid without
      // importing the production Events collection's app-write hooks.
      slug: 'events', fields: [{ name: 'title', type: 'text' }],
    }],
    db: postgresAdapter({ pool: { connectionString: dbURL.href, max: 16 }, schemaName: schema, push: true }),
  })
  payload = await getPayload({ config })
  dispatch = request => handleEndpoints({ config, request })

  function browser() {
    const jar = new Map<string, string>()
    const request = async (path: string, method = 'GET', data?: object) => {
      const headers = new Headers({ origin })
      if (jar.size) headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
      if (data !== undefined) headers.set('content-type', 'application/json')
      const response = await fetch(origin + path, {
        method, headers, ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000),
      })
      for (const entry of response.headers.getSetCookie()) {
        const pair = entry.split(';', 1)[0], index = pair.indexOf('=')
        const name = pair.slice(0, index), value = pair.slice(index + 1)
        if (!value || /max-age=0/i.test(entry)) jar.delete(name)
        else jar.set(name, value)
      }
      const body = await response.json()
      return { status: response.status, ok: response.ok, body }
    }
    const ok = async (path: string, method = 'GET', data?: object) => {
      const result = await request(path, method, data)
      assert.ok(result.ok, `${method} ${path}: HTTP ${result.status} ${JSON.stringify(result.body)}`)
      return result.body
    }
    return { jar, request, ok }
  }
  const password = 'fixture-only-' + randomBytes(16).toString('hex')
  const staff = async (name: string, role: 'admin' | 'moderator') => {
    const email = `${name}@example.invalid`
    const user = await payload!.create({ collection: 'admin-users', overrideAccess: true,
      data: { email, password, name, role, avatarUrl: `https://images.example.invalid/${name}.png` } })
    const b = browser()
    await b.ok('/payload-api/admin-users/login', 'POST', { email, password })
    assert.ok(b.jar.get('payload-token'), 'Real Payload login must issue its own session cookie')
    assert.equal(id((await b.ok('/payload-api/admin-users/me')).user), user.id)
    return { user, browser: b }
  }
  const admin = await staff('editor', 'admin')
  const owner = await staff('writer-one', 'moderator')
  const other = await staff('writer-two', 'moderator')
  const racer = await staff('parallel-writer', 'moderator')
  const anonymous = browser()
  const profilePath = '/payload-api/authors/me/profile'
  const denied = await anonymous.request(profilePath, 'POST', {})
  assert.ok([401, 403].includes(denied.status), JSON.stringify(denied))
  assert.equal((await payload.find({ collection: 'authors', limit: 100 })).totalDocs, 0)
  pass('real local login authenticates staff; anonymous provisioning is denied without writes')

  const profiles = await Promise.all(Array.from({ length: 6 }, () => owner.browser.ok(profilePath, 'POST', {
    user: other.user.id, id: 9999, role: 'super_admin', name: 'Forged profile target',
  })))
  const ownerAuthorID = id(profiles[0].author)
  assert.ok(ownerAuthorID > 0)
  for (const result of profiles) {
    assert.equal(id(result.author), ownerAuthorID)
    assert.equal(result.editURL, `/admin/collections/authors/${ownerAuthorID}`)
  }
  const ownerRows = await payload.find({ collection: 'authors', where: { user: { equals: owner.user.id } }, depth: 0 })
  assert.equal(ownerRows.totalDocs, 1)
  assert.equal(ownerRows.docs[0].name, owner.user.name, 'Endpoint must ignore submitted profile fields')
  assert.ok(!ownerRows.docs[0].email, 'Provisioning must not publish private staff email by default')
  assert.equal((await payload.find({ collection: 'authors', where: { user: { equals: other.user.id } } })).totalDocs, 0)
  pass('six concurrent profile requests create one linked author and ignore attacker-supplied IDs and fields')

  const simpleRequest = await owner.browser.request(profilePath, 'POST')
  assert.equal(simpleRequest.status, 415, 'Cross-site simple forms must not provision profiles')
  const foreignOrigin = await fetch(origin + profilePath, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://outside.example.invalid',
      cookie: [...owner.browser.jar].map(([name, value]) => `${name}=${value}`).join('; '),
      'sec-fetch-site': 'cross-site' }, body: '{}', signal: AbortSignal.timeout(30000),
  })
  assert.ok([401, 403].includes(foreignOrigin.status), 'Cross-origin requests must not use staff cookies')
  await foreignOrigin.arrayBuffer()
  pass('profile endpoint rejects simple form submissions and cross-origin authenticated requests')

  const otherAuthorID = id((await other.browser.ok(profilePath, 'POST', {})).author)
  const postData = (title: string, extra: object = {}) => ({ title, content, _status: 'draft', ...extra })
  const createdPosts = await Promise.all(Array.from({ length: 6 }, (_, index) => racer.browser.ok('/payload-api/posts', 'POST',
    postData(`Parallel author post ${index}`, { authors: [otherAuthorID], createdBy: other.user.id }))))
  const racerRows = await payload.find({ collection: 'authors', where: { user: { equals: racer.user.id } }, depth: 0 })
  assert.equal(racerRows.totalDocs, 1)
  const racerAuthorID = racerRows.docs[0].id
  for (const result of createdPosts) {
    const doc = result.doc
    assert.deepEqual(ids(doc.authors), [racerAuthorID])
    assert.equal(id(doc.createdBy), racer.user.id)
    assert.equal(doc._status, 'draft')
  }
  pass('six concurrent first posts share one author; spoofed byline and createdBy are replaced with authenticated identity')

  const published = (await owner.browser.ok('/payload-api/posts', 'POST', postData('Public profile propagation', { _status: 'published' }))).doc
  assert.deepEqual(ids(published.authors), [ownerAuthorID])
  assert.equal(id(published.createdBy), owner.user.id)
  const avatarBytes = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#8a54a2' } }).png().toBuffer()
  const avatar = await payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'Fixture author portrait', creditText: 'Fixture' },
    file: { data: avatarBytes, mimetype: 'image/png', name: 'author-fixture.png', size: avatarBytes.length } })
  const publicFields = {
    name: 'Edited public pen name', slug: 'edited-public-pen-name', email: 'public-byline@example.invalid',
    role: 'Contributing Editor', bio: 'An updated author biography.', avatar: avatar.id,
    socials: { instagram: 'fixture_ig', twitter: 'fixture_x', tiktok: 'fixture_tt', onlyfans: 'fixture_of', website: 'https://example.invalid/writer' },
    profileUrl: 'https://example.invalid/about-writer',
  }
  const edited = (await owner.browser.ok(`/payload-api/authors/${ownerAuthorID}`, 'PATCH', publicFields)).doc
  assert.equal(id(edited.user), owner.user.id)
  assert.equal(edited.avatarUrl, owner.user.avatarUrl)
  for (const key of ['name', 'slug', 'email', 'role', 'bio', 'profileUrl'] as const) assert.equal(edited[key], publicFields[key])
  assert.equal(id(edited.avatar), avatar.id)
  assert.deepEqual(edited.socials, publicFields.socials)
  const publicPost = await anonymous.ok(`/payload-api/posts/${published.id}?depth=2`)
  const publicAuthor = publicPost.authors.find((author: any) => id(author) === ownerAuthorID)
  assert.ok(publicAuthor, 'Published post must populate the changed author profile')
  for (const key of ['name', 'slug', 'role', 'bio', 'profileUrl'] as const) assert.equal(publicAuthor[key], publicFields[key])
  assert.equal(publicAuthor.email, undefined, 'Public population must not expose the author email field')
  assert.equal(publicAuthor.user, undefined, 'Public population must not expose the staff account link')
  assert.equal(id(publicAuthor.avatar), avatar.id)
  assert.deepEqual(publicAuthor.socials, publicFields.socials)
  assert.equal(id(publicPost.createdBy), owner.user.id)
  assert.equal((await owner.browser.ok('/payload-api/admin-users/me')).user.role, 'moderator')
  pass('owner edits every public profile field; populated published byline changes without changing staff role or creator')

  for (const attacker of [other.browser, anonymous]) {
    const response = await attacker.request(`/payload-api/authors/${ownerAuthorID}`, 'PATCH', { name: 'Hijacked' })
    assert.ok([401, 403, 404].includes(response.status), JSON.stringify(response))
  }
  const relink = await owner.browser.request(`/payload-api/authors/${ownerAuthorID}`, 'PATCH', {
    user: other.user.id, avatarUrl: 'https://outside.example.invalid/forged-avatar.png',
  })
  assert.ok(relink.ok || [400, 401, 403].includes(relink.status), JSON.stringify(relink))
  assert.equal(id((await payload.findByID({ collection: 'authors', id: ownerAuthorID, depth: 0 })).user), owner.user.id)
  assert.equal((await payload.findByID({ collection: 'authors', id: ownerAuthorID, depth: 0 })).avatarUrl, owner.user.avatarUrl)
  const spoofAuthor = await owner.browser.request('/payload-api/authors', 'POST', {
    name: 'Spoofed linked author', slug: 'spoofed-linked-author', user: other.user.id,
  })
  assert.ok(spoofAuthor.ok || [400, 401, 403, 409].includes(spoofAuthor.status), JSON.stringify(spoofAuthor))
  if (spoofAuthor.ok) assert.equal(id(spoofAuthor.body.doc.user), owner.user.id)
  assert.equal((await payload.find({ collection: 'authors', where: { user: { equals: other.user.id } }, depth: 0 })).totalDocs, 1)
  const otherPost = await other.browser.request(`/payload-api/posts/${published.id}`, 'PATCH', { title: 'Hijacked post' })
  assert.ok([401, 403, 404].includes(otherPost.status), JSON.stringify(otherPost))
  const adminTransfer = await admin.browser.request(`/payload-api/authors/${ownerAuthorID}`, 'PATCH', { user: other.user.id })
  assert.equal(adminTransfer.status, 400, 'Even editors cannot transfer established profile ownership')
  assert.equal(id((await payload.findByID({ collection: 'authors', id: ownerAuthorID, depth: 0 })).user), owner.user.id)
  pass('collection REST APIs reject cross-owner edits, author relinking, author creation spoofing and post IDOR')

  await owner.browser.ok(`/payload-api/posts/${published.id}`, 'PATCH', { authors: [], createdBy: other.user.id, excerpt: 'Autosaved excerpt' })
  let persisted = await payload.findByID({ collection: 'posts', id: published.id, depth: 0 })
  assert.deepEqual(ids(persisted.authors), [ownerAuthorID], 'Empty autosave must not erase attribution')
  assert.equal(id(persisted.createdBy), owner.user.id)
  const forgedUpdate = await owner.browser.request(`/payload-api/posts/${published.id}`, 'PATCH', { authors: [otherAuthorID] })
  assert.ok(forgedUpdate.ok || [400, 401, 403].includes(forgedUpdate.status), JSON.stringify(forgedUpdate))
  persisted = await payload.findByID({ collection: 'posts', id: published.id, depth: 0 })
  assert.deepEqual(ids(persisted.authors), [ownerAuthorID])
  assert.equal(id(persisted.createdBy), owner.user.id)
  pass('moderator autosaves and spoof attempts preserve existing byline and immutable createdBy')

  const legacy = (await db.query(`insert into ${schema}.authors (name,slug,created_at,updated_at) values ($1,$2,now(),now()) returning id`,
    ['Legacy unlinked contributor', 'legacy-unlinked-contributor'])).rows[0]
  await admin.browser.ok(`/payload-api/authors/${legacy.id}`, 'PATCH', { bio: 'Editorial update to an unlinked historical profile.' })
  const legacyAuthor = await payload.findByID({ collection: 'authors', id: legacy.id, depth: 0 })
  assert.equal(legacyAuthor.user, null)
  assert.equal(legacyAuthor.bio, 'Editorial update to an unlinked historical profile.')
  const editorial = (await admin.browser.ok('/payload-api/posts', 'POST', postData('Preserve historical bylines', { authors: [legacy.id, otherAuthorID] }))).doc
  assert.deepEqual(ids(editorial.authors), [legacy.id, otherAuthorID])
  assert.equal(id(editorial.createdBy), admin.user.id)
  // A moderator-created historical post can have an editorial byline. Ordinary
  // updates preserve it; only explicit selection of their own author replaces it.
  await admin.browser.ok(`/payload-api/posts/${published.id}`, 'PATCH', { authors: [legacy.id, otherAuthorID] })
  await owner.browser.ok(`/payload-api/posts/${published.id}`, 'PATCH', { excerpt: 'A content-only edit', authors: [] })
  persisted = await payload.findByID({ collection: 'posts', id: published.id, depth: 0 })
  assert.deepEqual(ids(persisted.authors), [legacy.id, otherAuthorID])
  await owner.browser.ok(`/payload-api/posts/${published.id}`, 'PATCH', { authors: [ownerAuthorID] })
  persisted = await payload.findByID({ collection: 'posts', id: published.id, depth: 0 })
  assert.deepEqual(ids(persisted.authors), [ownerAuthorID])
  assert.equal(id(persisted.createdBy), owner.user.id)
  pass('legacy unlinked profiles remain editable by admins; editorial overrides survive autosave and explicit self-attribution works')

  const firstLinkA = await staff('first-link-a', 'moderator')
  const firstLinkB = await staff('first-link-b', 'moderator')
  const racedLegacy = (await db.query(`insert into ${schema}.authors (name,slug,created_at,updated_at) values ($1,$2,now(),now()) returning id`,
    ['First-link race fixture', 'first-link-race-fixture'])).rows[0]
  linkRaceID = racedLegacy.id
  const linking = await Promise.all([firstLinkA, firstLinkB].map(target =>
    admin.browser.request(`/payload-api/authors/${racedLegacy.id}`, 'PATCH', { user: target.user.id })))
  linkRaceID = undefined
  assert.deepEqual(linking.map(result => result.status).sort(), [200, 409], 'Concurrent legacy claims must have exactly one winner')
  const winner = linking[0].ok ? firstLinkA : firstLinkB
  const linked = await payload.findByID({ collection: 'authors', id: racedLegacy.id, depth: 0 })
  assert.equal(id(linked.user), winner.user.id)
  assert.equal(id((await winner.browser.ok(profilePath, 'POST', {})).author), racedLegacy.id)
  pass('concurrent first links lock and recheck the author row; ownership cannot transfer through stale originalDoc')

  const emailNamed = await staff('email-fallback', 'moderator')
  await payload.update({ collection: 'admin-users', id: emailNamed.user.id, data: { name: emailNamed.user.email } })
  const privateNameProfile = await emailNamed.browser.ok(profilePath, 'POST', {})
  assert.equal(privateNameProfile.author.name, 'Staff writer')
  const publicPrivateName = await anonymous.ok(`/payload-api/authors/${privateNameProfile.author.id}`)
  assert.ok(!JSON.stringify(publicPrivateName).includes(emailNamed.user.email))
  pass('email-based legacy account names never become automatic public bylines')

  const untouchedLegacy = await payload.findByID({ collection: 'authors', id: legacy.id, depth: 0 })
  assert.equal(untouchedLegacy.user, null)
  const stillDraft = await anonymous.request(`/payload-api/posts/${createdPosts[0].doc.id}`)
  assert.equal(stillDraft.status, 404, 'Profile work must not expose unpublished posts')
  const selectable = await staff('selectable-account-without-profile', 'moderator')
  const beforeChoices = (await payload.find({ collection: 'authors', limit: 100 })).totalDocs
  const choices = await admin.browser.ok(`/payload-api/authors/accounts?include=${selectable.user.id}`)
  assert.ok(choices.accounts.some((account: any) => account.id === selectable.user.id && account.name === selectable.user.name))
  assert.ok(!JSON.stringify(choices).includes('@example.invalid'), 'Account picker never exposes private staff email')
  assert.equal((await payload.find({ collection: 'authors', limit: 100 })).totalDocs, beforeChoices, 'Listing accounts never provisions profiles')
  const ownChoices = await owner.browser.ok('/payload-api/authors/accounts')
  assert.deepEqual(ownChoices.accounts.map((account: any) => account.id), [owner.user.id])
  assert.ok([401,403].includes((await anonymous.request('/payload-api/authors/accounts')).status))
  assert.equal((await owner.browser.request('/payload-api/authors/account/profile', 'POST', { accountID: selectable.user.id })).status, 403)
  const selectedProfiles = await Promise.all(Array.from({ length: 4 }, () => admin.browser.ok('/payload-api/authors/account/profile', 'POST', { accountID: selectable.user.id })))
  const selectedID = id(selectedProfiles[0].author)
  assert.ok(selectedProfiles.every(result => id(result.author) === selectedID))
  const originalEditorial = await payload.findByID({ collection: 'posts', id: editorial.id, depth: 0 })
  await admin.browser.ok(`/payload-api/posts/${editorial.id}`, 'PATCH', { authors: [...ids(originalEditorial.authors!), selectedID] })
  const addedEditorial = await payload.findByID({ collection: 'posts', id: editorial.id, depth: 0 })
  assert.deepEqual(ids(addedEditorial.authors!), [...ids(originalEditorial.authors!), selectedID])
  assert.equal(id(addedEditorial.createdBy), id(originalEditorial.createdBy))
  const changedPhoto = 'https://images.example.invalid/new-current-profile.jpg'
  await payload.update({ collection: 'admin-users', id: selectable.user.id, data: { avatarUrl: changedPhoto } })
  const visibleProfile = await anonymous.ok(`/payload-api/authors/${selectedID}`)
  assert.equal(visibleProfile.avatarUrl, changedPhoto, 'Read hydration follows linked profile instead of stale author copy')
  assert.equal(visibleProfile.user, undefined); assert.equal(visibleProfile.email, undefined)
  pass('real-account picker includes unprovisioned staff without writes, enforces roles, provisions once and preserves credits; public image hydrates privately')
  console.log(`${results.length} real HTTP/PostgreSQL author-profile integration groups passed; no external accounts or database used`)
} finally {
  console.log('CLEANUP: fixture HTTP server')
  server?.closeAllConnections()
  await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve())
  const payloadPool = payload?.db.pool as (Pool & {
    _clients?: Array<{ release: () => void }>
    _idle?: Array<{ client: unknown }>
  }) | undefined
  await payload?.destroy()
  // The pinned Payload canary retains a startup checkout after destroy(). This
  // isolated fixture owns the pool, so release it before closing the database.
  const idle = new Set(payloadPool?._idle?.map(item => item.client))
  for (const client of payloadPool?._clients ?? []) if (!idle.has(client)) client.release()
  await payloadPool?.end()
  await db.end()
  console.log('CLEANUP: complete')
}
