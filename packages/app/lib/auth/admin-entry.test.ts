import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminLoginRedirect, adminPath, resolveAdminEntry } from './admin-entry.ts'

const base = { path: '/admin/collections/posts', search: {}, hasAdminUser: false, hasActiveAppSession: false }
test('expired/revoked/missing sessions recover the exact editor destination', () => {
  const login = adminLoginRedirect({ ...base, search: { 'where[status]': 'draft', tag: ['a', 'b'] } })!
  const target = new URL(login, 'https://example.invalid').searchParams.get('returnTo')!
  const url = new URL(target, 'https://example.invalid')
  assert.equal(url.pathname, base.path)
  assert.equal(url.searchParams.get('where[status]'), 'draft')
  assert.deepEqual(url.searchParams.getAll('tag'), ['a', 'b'])
})
test('server-validated legacy and SSO staff sessions stay with Payload authorization', () => {
  assert.equal(adminLoginRedirect({ ...base, hasAdminUser: true }), null)
})
test('active app users without a CMS user are not sent through an authenticated redirect loop', () => {
  assert.equal(adminLoginRedirect({ ...base, hasActiveAppSession: true }), null)
})
test('only explicit local login bypasses recovery; logout runs its cleanup without cookies', () => {
  assert.equal(adminLoginRedirect({ ...base, path: '/admin/login', search: { local: '1' } }), null)
  assert.notEqual(adminLoginRedirect({ ...base, search: { local: '1' } }), null)
  assert.notEqual(adminLoginRedirect({ ...base, path: '/admin/login', search: { local: ['1', '0'] } }), null)
  assert.equal(adminLoginRedirect({ ...base, path: '/admin/logout' }), null)
})
test('Payload login redirects preserve safe admin paths and reject external/auth/logout loops', () => {
  const read = (redirect: string) => new URL(adminLoginRedirect({ ...base, path: '/admin/login', search: { redirect } })!, 'https://example.invalid').searchParams.get('returnTo')
  assert.equal(read('/admin/collections/posts/12?tab=versions'), '/admin/collections/posts/12?tab=versions')
  for (const unsafe of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/auth/login', '/admin/login', '/admin/logout', '/administrator', '/feed', '%2F%2Fevil.invalid']) {
    assert.equal(read(unsafe), '/admin/collections/posts', unsafe)
  }
})
test('decoded route segments cannot create a protocol-relative return destination', () => {
  assert.equal(adminPath(), '/admin')
  assert.equal(adminPath(['collections', 'posts', 'a/b']), '/admin/collections/posts/a%2Fb')
})

test('server gate authenticates before recovery; valid legacy users never need app session lookup', async () => {
  const calls: string[] = []
  const server = {
    authenticate: async (): Promise<unknown | null> => { calls.push('payload'); return { role: 'moderator' } },
    readAppSession: async () => { calls.push('app'); return null },
  }
  assert.equal(await resolveAdminEntry(base, server), null)
  assert.deepEqual(calls, ['payload'])
  calls.length = 0
  server.authenticate = async () => { calls.push('payload'); return null }
  assert.match((await resolveAdminEntry(base, server))!, /^\/auth\/login\?returnTo=/)
  assert.deepEqual(calls, ['payload', 'app'])
})
test('server gate preserves local recovery without reads; unavailable auth is never interpreted as expiry', async () => {
  const unavailable = async () => { throw new Error('backend unavailable') }
  const server = { authenticate: unavailable, readAppSession: unavailable }
  assert.equal(await resolveAdminEntry({ path: '/admin/login', search: { local: '1' } }, server), null)
  assert.equal(await resolveAdminEntry({ path: '/admin/logout', search: {} }, server), null)
  await assert.rejects(resolveAdminEntry(base, server), /backend unavailable/)
  await assert.rejects(resolveAdminEntry(base, { ...server, authenticate: async () => null }), /backend unavailable/)
})
