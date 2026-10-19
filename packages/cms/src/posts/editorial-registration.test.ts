import test from 'node:test'
import assert from 'node:assert/strict'
import { getOptionalEditorialCollections } from '../config/editorialCollections.ts'

// Config sanitization is real Payload code but never initializes a DB or starts
// a server. Explicit local-only settings ensure this fixture cannot use prod.
process.env.NEXT_PUBLIC_DVNT_LOCAL_BUILD_ONLY = '1'
process.env.PAYLOAD_SECRET = 'isolated-config-test-not-a-real-secret'
delete process.env.PAYLOAD_PUSH
delete process.env.PAYLOAD_EDITORIAL_COLLECTIONS_READY

test('unfinished editorial collections require an exact explicit readiness assertion', () => {
  for (const value of [undefined, '', 'false', '0', '1', 'TRUE']) {
    assert.deepEqual(getOptionalEditorialCollections(value), [])
  }
  assert.deepEqual(getOptionalEditorialCollections('true').map((c) => c.slug), ['editorial-channels', 'editorial-queue'])
})

test('real sanitized Payload config matches the provisioned shared lock relationships', async () => {
  const { default: promise } = await import('../payload.config.ts')
  const config = await promise
  const lock = config.collections.find((c) => c.slug === 'payload-locked-documents')!
  const document = lock.fields.find((f: any) => f.name === 'document') as any
  // Observed provisioned relation columns on 2026-10-19. In particular, the two
  // unprovisioned editorial collections must not poison unrelated post edits.
  assert.deepEqual(document.relationTo, [
    'admin-users', 'members', 'reports', 'events', 'tickets', 'ban-list',
    'moderation-actions', 'posts', 'categories', 'authors', 'media', 'comments', 'sentry-alerts',
  ])
  assert.ok(config.collections.every((c) => !['editorial-channels', 'editorial-queue'].includes(c.slug)))
  const posts = config.collections.find((c) => c.slug === 'posts')!
  assert.notEqual(posts.lockDocuments, false)
  const fields = posts.fields.flatMap((f: any) => f.type === 'group' && !f.name ? f.fields : [f]) as any[]
  assert.equal(fields.filter((f) => f.name === 'updatedAt').length, 1)
  assert.equal(fields.filter((f) => f.name === 'createdAt').length, 1)
  assert.equal(fields.filter((f) => f.name === '_status').length, 1)
  assert.equal(new Set(fields.map((f) => f.name)).size, fields.length)
  assert.equal(config.telemetry, false)
})
