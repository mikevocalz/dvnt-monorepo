import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveStaffPhoto, safePhotoURL } from './account-photo.ts'
const account = { email: 'private@example.invalid', avatarUrl: 'https://example.invalid/old.jpg' }
test('current linked app image wins over stale CMS image without returning private account data', async () => {
  const result = await resolveStaffPhoto(account, async email => {
    assert.equal(email, account.email)
    return [{ avatar_id: 123, url: 'https://example.invalid/new.jpg' }]
  })
  assert.equal(result, 'https://example.invalid/new.jpg')
})
test('confirmed avatar removal clears stale fallback; missing media and unavailable sources preserve safe fallback', async () => {
  assert.equal(await resolveStaffPhoto(account, async () => [{ avatar_id: null, url: null }]), null)
  for (const rows of [null, [], [{ avatar_id: 1, url: null }], [{ avatar_id: 1, url: 'javascript:alert(1)' }], [{ avatar_id: 1, url: 'https://a.invalid' }, { avatar_id: 2, url: 'https://b.invalid' }]])
    assert.equal(await resolveStaffPhoto(account, async () => rows), account.avatarUrl)
  assert.equal(await resolveStaffPhoto(account, async () => { throw new Error('unavailable') }), account.avatarUrl)
  assert.equal(await resolveStaffPhoto({ ...account, avatarUrl: 'data:image/png,unsafe' }, async () => null), null)
  assert.equal(safePhotoURL('javascript:alert(1)'), null)
})
