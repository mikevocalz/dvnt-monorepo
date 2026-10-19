import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminSignOut } from './admin-sign-out.ts'

function fixture() {
  const calls: string[] = []
  let app = true
  let cms = true
  const deps = {
    clearLocalState: () => { calls.push('clear') },
    payloadLogout: async () => { calls.push('payload'); cms = false },
    betterAuthSignOut: async () => { calls.push('app'); app = false; return { data: { success: true } } },
    readPayloadUser: async () => { calls.push('verify'); return { user: app || cms ? { role: 'admin' } : null } },
  }
  return { calls, deps, reload: () => deps.readPayloadUser() }
}

test('both authorities end before success; refresh/back cannot reauthenticate', async () => {
  const f = fixture()
  await createAdminSignOut(f.deps)()
  assert.deepEqual(f.calls, ['clear', 'app', 'payload', 'verify'])
  assert.equal((await f.reload()).user, null)
})

test('Better Auth still runs if Payload logout fails; residual local session is an error', async () => {
  const f = fixture()
  f.deps.payloadLogout = async () => { throw new Error('network') }
  await assert.rejects(createAdminSignOut(f.deps)(), /not been confirmed closed/)
  assert.deepEqual(f.calls, ['clear', 'app', 'verify'])
})

test('an expired Payload session is successful only after server confirms no admin user', async () => {
  const f = fixture()
  f.deps.payloadLogout = async () => { throw new Error('No User') }
  f.deps.readPayloadUser = async () => ({ user: null })
  await createAdminSignOut(f.deps)()
  assert.deepEqual(f.calls, ['clear', 'app'])
})

test('Better Auth failures preserve the local Payload cookie/session for retry', async () => {
  for (const signOut of [
    async () => ({ error: { message: 'unavailable' } }),
    async () => { throw new Error('offline') },
    async () => ({ data: { success: false } }),
  ]) {
    const f = fixture()
    const run = createAdminSignOut({ ...f.deps, betterAuthSignOut: signOut })
    await assert.rejects(run())
    assert.deepEqual(f.calls, ['clear'])
  }
})

test('failed final verification stays unconfirmed', async () => {
  const f = fixture()
  f.deps.readPayloadUser = async () => { throw new Error('offline') }
  await assert.rejects(createAdminSignOut(f.deps)(), /offline/)
})

test('a malformed verification response is not proof of logout', async () => {
  const f = fixture()
  await assert.rejects(createAdminSignOut({ ...f.deps, readPayloadUser: async () => ({ user: undefined }) })(), /not been confirmed closed/)
})

test('local cleanup failure cannot prevent attempting both server sign-outs', async () => {
  const f = fixture()
  await assert.rejects(createAdminSignOut({ ...f.deps, clearLocalState: () => { throw new Error('storage') } })(), /Browser cleanup/)
  assert.deepEqual(f.calls, ['app', 'payload', 'verify'])
  assert.equal((await f.reload()).user, null)
})

test('SSO must be removed before Payload can identify and revoke its local session', async () => {
  const calls: string[] = []
  let app = true, local = true
  await createAdminSignOut({
    clearLocalState: () => {},
    betterAuthSignOut: async () => { calls.push('app'); app = false; return { data: { success: true } } },
    payloadLogout: async () => { calls.push('payload'); if (!app) local = false },
    readPayloadUser: async () => ({ user: app || local ? { role: 'admin' } : null }),
  })()
  assert.deepEqual(calls, ['app', 'payload'])
  assert.equal(local, false)
})

test('double click/StrictMode share one operation; partial failure can be retried', async () => {
  const f = fixture()
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const original = f.deps.betterAuthSignOut
  let fail = true
  const run = createAdminSignOut({ ...f.deps, betterAuthSignOut: async () => {
    await wait
    if (fail) return { error: 'temporary failure' }
    return original()
  } })
  const first = run()
  assert.equal(run(), first)
  release()
  await assert.rejects(first)
  fail = false
  await run()
  assert.equal((await f.reload()).user, null)
  assert.equal(f.calls.filter(c => c === 'clear').length, 2)
})
