import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { fieldSchemasToFormState } from '@payloadcms/ui/forms/fieldSchemasToFormState'
import { reduceFieldsToValues } from 'payload/shared'
import { Posts } from '../collections/Posts.ts'

// Snapshot of the pre-layout collection's persisted schema. Presentation groups
// must not rename a column, relationship, array table or stored JSON path.
const previousSchema = JSON.parse(readFileSync(new URL('./__fixtures__/post-schema.json', import.meta.url), 'utf8'))
const flatFields = Posts.fields.flatMap((field: any) => field.type === 'group' && !field.name ? field.fields : [field]).filter((field: any) => field.type !== 'ui')
const field = (name: string): any => flatFields.find((item: any) => item.name === name)

const content = {
  root: {
    type: 'root', version: 1, direction: null, format: '', indent: 0,
    children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0,
      children: [{ type: 'text', version: 1, text: 'An editable fixture article.', format: 0, detail: 0, mode: 'normal', style: '' }],
    }, { type: 'block', version: 2, format: '', fields: {
      id: 'quote-fixture', blockType: 'pullQuote', blockName: '', quote: 'A fixture quote.', attribution: 'Fixture writer',
    } }],
  },
}
const fixture = {
  title: 'Fixture article', slug: 'fixture-article', excerpt: 'A fixture summary.', eyebrow: 'Culture',
  heroImage: 21, heroVideoUrl: 'https://example.com/hero.mp4', heroCaption: 'Fixture caption',
  content, contentHtml: '<p>An editable fixture article.</p>',
  categories: [31], tags: [{ id: 'tag-fixture', tag: 'community' }], authors: [41], createdBy: 51,
  contributors: [{ id: 'contributor-fixture', author: 42, role: 'Photographs by' }],
  featured: true, editorsPick: false, trending: true, readTime: 4, relatedPosts: [61],
  publishedAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-02T12:00:00.000Z',
  seo: { title: 'Search title', description: 'Search description', ogImage: 22,
    canonicalUrl: 'https://example.com/fixture', noIndex: false, structuredData: { '@type': 'Article' } },
  meta: { title: 'Legacy title', description: 'Legacy description', image: 23 }, coverImage: 24,
}

async function readForm(data: Record<string, unknown>) {
  return fieldSchemasToFormState({
    fields: Posts.fields, data: structuredClone(data), operation: 'update',
    collectionSlug: 'posts', schemaPath: 'posts', permissions: true,
    renderAllFields: true, skipValidation: true,
    req: { user: { id: 51, role: 'moderator' }, payload: { config: { localization: false }, logger: console } },
  } as any)
}

test('one-page sections preserve every existing persisted field schema and order', () => {
  const persistentSchema = flatFields.map(({ admin, hooks, editor, access, ...persisted }: any) => persisted)
  assert.deepEqual(persistentSchema, previousSchema)
  assert.equal(new Set(flatFields.map((f: any) => f.name)).size, flatFields.length)
  assert.equal(Posts.dbName, 'posts')
  assert.notEqual(Posts.lockDocuments, false)
  assert.deepEqual(Posts.versions, { drafts: { autosave: { interval: 375 } }, maxPerDoc: 25 })
})

test('all editable sections are always visible in the main form, with native labeled fields', () => {
  const sections = Posts.fields.filter((f: any) => f.type === 'group' && !f.name) as any[]
  assert.equal(sections.length, 10)
  for (const section of sections) {
    assert.ok(section.label.length > 0)
    assert.ok(section.admin.description.length > 0)
    assert.equal(section.admin.condition, undefined)
    assert.equal(section.admin.hidden, undefined)
    assert.equal(section.admin.position, undefined)
  }
  for (const f of flatFields) {
    assert.notEqual(f.admin?.position, 'sidebar', f.name)
    assert.equal(f.admin?.condition, undefined, f.name)
    if (f.name !== 'contentHtml') assert.notEqual(f.admin?.hidden, true, f.name)
  }
  assert.equal(field('content').required, true)
  assert.equal(field('contentHtml').admin.hidden, true, 'derived HTML is not a competing editor')
  assert.equal(field('createdBy').admin.readOnly, true)
  assert.equal(field('updatedAt').admin.readOnly, true)
  assert.ok(Posts.fields.some((f: any) => f.name === 'updatedAt'), 'Payload timestamp detection requires root placement')
})

test('Payload native form read / save serialization round-trips every section without nested layout keys', async () => {
  const state = await readForm(fixture)
  assert.equal(state['seo.title'].value, fixture.seo.title)
  assert.equal(state['meta.title'].passesCondition, undefined)
  assert.equal(state.coverImage.passesCondition, undefined)
  const saved = reduceFieldsToValues(state, true)
  assert.deepEqual(saved, fixture)
  assert.ok(!Object.keys(saved).some((key) => key.startsWith('_index-')))

  // Editing fields across sections uses one document payload, including rich
  // content/blocks, relationship IDs, array rows and legacy values.
  state.title.value = 'Updated fixture title'
  state.heroCaption.value = 'Updated hero caption'
  state['tags.0.tag'].value = 'editorial'
  state['contributors.0.role'].value = 'Reporting by'
  state['seo.description'].value = 'Updated search description'
  state['meta.title'].value = 'Updated legacy title'
  const edited = reduceFieldsToValues(state, true) as any
  const reread = await readForm(edited)
  assert.deepEqual(reduceFieldsToValues(reread, true), edited)
  assert.equal(edited.title, 'Updated fixture title')
  assert.equal(edited.heroCaption, 'Updated hero caption')
  assert.equal(edited.tags[0].tag, 'editorial')
  assert.equal(edited.contributors[0].role, 'Reporting by')
  assert.equal(edited.seo.description, 'Updated search description')
  assert.equal(edited.meta.title, 'Updated legacy title')
  assert.deepEqual(edited.content, fixture.content)
  assert.deepEqual(edited.relatedPosts, fixture.relatedPosts)
})

test('read and write access remain published-only for visitors and owner-scoped for moderators', async () => {
  const call = (operation: string, user: any) => (Posts.access as any)[operation]({ req: { user } })
  assert.deepEqual(await call('read', null), { _status: { equals: 'published' } })
  for (const role of ['admin', 'super_admin']) {
    for (const operation of ['create', 'read', 'update', 'delete', 'readVersions']) {
      assert.equal(await call(operation, { id: 51, role }), true)
    }
  }
  for (const operation of ['update', 'delete']) {
    assert.deepEqual(await call(operation, { id: 51, role: 'moderator' }), { createdBy: { equals: 51 } })
    assert.equal(await call(operation, null), false)
    assert.equal(await call(operation, { id: 9, role: 'member' }), false)
  }
  assert.equal(await call('create', null), false)
  assert.equal(await call('readVersions', null), false)
  assert.equal(await field('createdBy').access.update({}), false)
})

test('existing create/publish hooks and slug formatting continue to use root document values', async () => {
  const hook = Posts.hooks!.beforeChange![0]
  const req = { user: { id: 51, role: 'moderator' } }
  const draft = await hook({ data: { title: 'New post', _status: 'draft' }, operation: 'create', req } as any)
  assert.equal(draft?.createdBy, 51)
  assert.equal(draft?.publishedAt, undefined)
  const published = await hook({ data: { ...fixture, _status: 'published', publishedAt: null, readTime: null }, operation: 'update', req } as any)
  assert.ok(!Number.isNaN(Date.parse(published!.publishedAt)))
  assert.equal(published?.createdBy, fixture.createdBy)
  assert.equal(published?.readTime, 1)
  assert.equal(field('slug').hooks.beforeValidate[0]({ data: { title: 'A New Story!' } }), 'a-new-story')
  assert.equal(field('slug').hooks.beforeValidate[0]({ value: 'My Chosen Slug', data: { title: 'Ignored' } }), 'my-chosen-slug')
})
