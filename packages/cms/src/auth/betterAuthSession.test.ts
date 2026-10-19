import { test } from 'node:test'
import assert from 'node:assert/strict'
import { betterAuthTokenFromCookie, readBetterAuthSession } from './betterAuthSession.ts'

const now = Date.parse('2026-10-19T00:00:00Z')
test('both supported cookie names parse; malformed/empty values stay unauthenticated', () => {
  for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token']) {
    assert.equal(betterAuthTokenFromCookie(`other=x; ${name}=fixture%2Esignature`), 'fixture')
    assert.equal(betterAuthTokenFromCookie(`${name}=%E0%A4%A`), null)
    assert.equal(betterAuthTokenFromCookie(`${name}=`), null)
  }
  assert.equal(betterAuthTokenFromCookie('unrelated=value'), null)
})
test('cookie presence never authenticates a revoked, expired or malformed-expiry session', async () => {
  for (const result of [undefined, { userId: 'fixture', expiresAt: new Date(now - 1) }, { userId: 'fixture', expiresAt: new Date(now) }, { userId: 'fixture', expiresAt: 'invalid' }]) {
    assert.equal(await readBetterAuthSession('better-auth.session_token=fixture.sig', async () => result, now), null)
  }
})
test('valid session is read using only its token; no writes/provisioning in this helper', async () => {
  const session = { userId: 'fixture', expiresAt: new Date(now + 1000) }
  assert.equal(await readBetterAuthSession('__Secure-better-auth.session_token=fixture.sig', async token => {
    assert.equal(token, 'fixture')
    return session
  }, now), session)
})
test('missing/malformed cookie does not query, and DB failure is not treated as expiration', async () => {
  const fail = async () => { throw new Error('database unavailable') }
  assert.equal(await readBetterAuthSession(null, fail, now), null)
  await assert.rejects(readBetterAuthSession('better-auth.session_token=fixture.sig', fail, now), /database unavailable/)
})
test('missing app database configuration with a cookie is unavailable, not expired', async () => {
  const original = process.env.APP_DATABASE_URL
  delete process.env.APP_DATABASE_URL
  try {
    assert.equal(await readBetterAuthSession(null), null)
    await assert.rejects(readBetterAuthSession('better-auth.session_token=fixture.sig'), /validation is unavailable/)
  } finally {
    if (original === undefined) delete process.env.APP_DATABASE_URL
    else process.env.APP_DATABASE_URL = original
  }
})
