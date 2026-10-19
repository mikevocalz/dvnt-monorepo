import test from 'node:test'
import assert from 'node:assert/strict'
import { pgSchema, serial } from 'drizzle-orm/pg-core'
import { ensureOwnAuthor, enforcePostAttribution, prepareAuthorProfile,
  staffAccount, updateAuthorAccess, authorsProfileEndpoint } from './profiles.ts'
import { Authors } from '../collections/Authors.ts'

const accounts = pgSchema('fixture').table('admin_users', { id: serial('id') })
function fixture(role = 'moderator', userID = 3) {
  const docs: any[] = []
  const calls: any[] = []
  const req: any = { user: { id: userID, role, collection: 'admin-users', name: 'Real writer', email: 'private@example.invalid' },
    transactionID: 'tx', headers: new Headers({ 'content-type': 'application/json' }), payload: {
      config: { routes: { admin: '/admin' } },
      db: { tables: { admin_users: accounts }, sessions: { tx: { db: {} } }, execute: async (args: any) => { calls.push(['lock', args]); return { rows: [{ id: userID }] } } },
      find: async (args: any) => { calls.push(['find', args]); return { docs: docs.filter(d => String(d.user) === String(args.where.user.equals)).sort((a,b) => a.id-b.id).slice(0,1) } },
      create: async (args: any) => { calls.push(['create', args]); const doc = { id: docs.length + 50, ...args.data }; docs.push(doc); return doc },
      findByID: async (args: any) => { calls.push(['account', args]); return { id: args.id, role: 'moderator', name: 'Linked writer', avatarUrl: 'https://example.invalid/avatar.jpg' } },
    } }
  return { req, docs, calls }
}
const hook = (fn: any, req: any, data: any, operation = 'create', originalDoc: any = {}) => fn({ req, data, operation, originalDoc })

test('identity requires a real authenticated CMS staff account, not an app/member ID or role alone', () => {
  assert.equal(staffAccount({ user: null } as any), null)
  assert.equal(staffAccount({ user: { id: 3, role: 'moderator', collection: 'members' } } as any), null)
  assert.equal(staffAccount({ user: { id: 3, role: 'Basic', collection: 'admin-users' } } as any), null)
  assert.equal(staffAccount(fixture().req)?.id, 3)
  assert.deepEqual(updateAuthorAccess({ req: fixture().req }), { user: { equals: 3 } })
  assert.equal(updateAuthorAccess({ req: fixture('admin').req }), true)
})
test('provisioning uses the account ID, locked transaction and existing link, never email/name/author IDs', async () => {
  const { req, docs, calls } = fixture()
  const author = await ensureOwnAuthor(req)
  assert.equal(author.user, 3)
  assert.equal(author.name, 'Real writer')
  assert.equal(author.email, undefined)
  assert.match(author.slug!, /^writer-3-/)
  assert.equal(calls[0][0], 'lock')
  for (const [operation, args] of calls) if (operation !== 'lock') assert.equal(args.req, req)
  assert.equal((await ensureOwnAuthor(req)).id, author.id)
  assert.equal(docs.length, 1)
  docs.push({ id: 1, user: null, name: 'Seed profile' })
  assert.equal((await ensureOwnAuthor(req)).id, author.id)
  req.transactionID = undefined
  await assert.rejects(() => ensureOwnAuthor(req), /active database transaction/)
})
test('new posts always stamp the creating account and moderator byline; editorial overrides stay admin-only', async () => {
  const { req } = fixture()
  const result = await hook(enforcePostAttribution, req, { createdBy: 11, authors: [99], contributors: [{ author: 99, role: 'Writer' }] })
  assert.equal(result.createdBy, 3)
  assert.deepEqual(result.authors, [50])
  assert.deepEqual(result.contributors, [])
  const admin = fixture('admin')
  assert.deepEqual((await hook(enforcePostAttribution, admin.req, { authors: [99] })).authors, [99])
  assert.deepEqual((await hook(enforcePostAttribution, admin.req, { authors: [] })).authors, [50])
})
test('updates preserve attribution, including legacy seeds, and only explicit own replacement is allowed for moderators', async () => {
  const { req } = fixture()
  const original = { createdBy: 3, authors: [1], contributors: [{ author: 2, role: 'Photos' }] }
  const unchanged = await hook(enforcePostAttribution, req, { title: 'Edit', createdBy: 99 }, 'update', original)
  assert.equal(unchanged.createdBy, 3)
  assert.deepEqual(unchanged.authors, [1])
  assert.deepEqual(unchanged.contributors, original.contributors)
  await assert.rejects(() => hook(enforcePostAttribution, req, { authors: [99] }, 'update', original), /own byline/)
  const own = await hook(enforcePostAttribution, req, { authors: [50] }, 'update', original)
  assert.deepEqual(own.authors, [50])
  assert.equal(own.createdBy, 3)
  const admin = fixture('super_admin')
  const legacy = await hook(enforcePostAttribution, admin.req, { authors: [77], createdBy: 99 }, 'update', { authors: [1], createdBy: null })
  assert.equal(legacy.createdBy, null)
  assert.deepEqual(legacy.authors, [77])
})
test('profiles use the owner link and defaults; legacy rows survive and new duplicate links fail', async () => {
  const { req, docs } = fixture()
  const created = await hook(prepareAuthorProfile, req, { user: 11, name: '' })
  assert.equal(created.user, 3)
  assert.equal(created.name, 'Linked writer')
  assert.equal(created.avatarUrl, 'https://example.invalid/avatar.jpg')
  await assert.rejects(() => hook(prepareAuthorProfile, req, {}, 'update', { id: 99, user: 11 }), /own author profile/)
  docs.push({ id: 50, user: 3 })
  await assert.rejects(() => hook(prepareAuthorProfile, req, {}), /already has an author profile/)
  const edited = await hook(prepareAuthorProfile, req, { user: 11, name: 'My pen name', bio: 'Updated' }, 'update', { id: 50, user: 3 })
  assert.equal(edited.user, 3)
  assert.equal(edited.name, 'My pen name')
  const admin = fixture('admin')
  const legacy = await hook(prepareAuthorProfile, admin.req, { bio: 'Old record edited' }, 'update', { id: 1, user: null })
  assert.equal(legacy.user, undefined)
  await assert.rejects(() => hook(prepareAuthorProfile, admin.req, { user: null }, 'update', { user: 3 }), /cannot be removed/)
})
test('the own-profile endpoint ignores supplied identity and rejects anonymous/simple cross-site requests', async () => {
  const { req } = fixture()
  req.json = () => ({ user: 11, id: 99 })
  const response = await authorsProfileEndpoint.handler(req)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { author: { id: 50, name: 'Real writer' }, editURL: '/admin/collections/authors/50' })
  req.headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' })
  assert.equal((await authorsProfileEndpoint.handler(req)).status, 415)
  req.user = null
  assert.equal((await authorsProfileEndpoint.handler(req)).status, 403)
})
test('public author reads cannot reveal the linked private account or contact email', async () => {
  for (const name of ['user', 'email']) {
    const field = Authors.fields.find((field: any) => field.name === name) as any
    assert.equal(field.access.read({ req: { user: null } }), false)
    assert.equal(field.access.read({ req: fixture().req }), true)
  }
})
