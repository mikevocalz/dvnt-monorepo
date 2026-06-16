// scripts/seed-demo.ts — local demo data so the dashboard + blog aren't empty.
// Idempotent-ish: safe to run once on a fresh local DB.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

async function run() {
  const payload = await getPayload({ config })

  const members = [
    { username: 'nova_reyes', email: 'nova@example.com', status: 'active', openReportsAgainst: 0 },
    { username: 'dex_mor', email: 'dex@example.com', status: 'under_review', openReportsAgainst: 3 },
    { username: 'kai_sol', email: 'kai@example.com', status: 'warned', openReportsAgainst: 1 },
    { username: 'echo_vane', email: 'echo@example.com', status: 'suspended', openReportsAgainst: 2 },
    { username: 'rune_ash', email: 'rune@example.com', status: 'shadow_banned', openReportsAgainst: 4 },
    { username: 'lux_vire', email: 'lux@example.com', status: 'banned', openReportsAgainst: 5 },
    { username: 'mira_quill', email: 'mira@example.com', status: 'active', openReportsAgainst: 0 },
  ]
  const created: any[] = []
  for (const m of members) {
    const existing = await payload.find({ collection: 'members', where: { email: { equals: m.email } }, limit: 1 })
    if (existing.totalDocs) { created.push(existing.docs[0]); continue }
    created.push(await payload.create({ collection: 'members', data: m as any, overrideAccess: true }))
  }

  const host = created[0]
  const evExisting = await payload.find({ collection: 'events', where: { title: { equals: 'Deviant Warehouse · Vol. 9' } }, limit: 1 })
  if (!evExisting.totalDocs) {
    await payload.create({
      collection: 'events',
      overrideAccess: true,
      data: {
        title: 'Deviant Warehouse · Vol. 9',
        status: 'published',
        startsAt: '2026-07-04T22:00:00.000Z',
        location: 'Undisclosed · DC',
        host: host.id,
        capacity: 500,
        attendees: 312,
        ticketsSold: 287,
        ticketTiers: [
          { name: 'GA', priceCents: 3500, quantity: 400, soldCount: 240, active: true },
          { name: 'VIP', priceCents: 9000, quantity: 100, soldCount: 47, active: true },
        ],
      } as any,
    })
  }

  const reportsExisting = await payload.count({ collection: 'reports', overrideAccess: true })
  if (reportsExisting.totalDocs === 0) {
    for (const r of [
      { reportedMember: created[1].id, reason: 'Harassment in DMs', category: 'harassment', status: 'open' },
      { reportedMember: created[1].id, reason: 'Repeated spam links', category: 'spam', status: 'open' },
      { reportedMember: created[4].id, reason: 'Impersonating an organizer', category: 'impersonation', status: 'open' },
    ]) {
      await payload.create({ collection: 'reports', data: r as any, overrideAccess: true })
    }
  }

  const postExisting = await payload.find({ collection: 'posts', where: { slug: { equals: 'welcome-to-the-deviant-blog' } }, limit: 1 })
  if (!postExisting.totalDocs) {
    await payload.create({
      collection: 'posts',
      overrideAccess: true,
      data: {
        title: 'Welcome to the Deviant blog',
        slug: 'welcome-to-the-deviant-blog',
        _status: 'published',
        publishedAt: new Date('2026-06-15').toISOString(),
        excerpt: 'News, guides, and stories from DVNT — authored in Payload, rendered on the web.',
        content: {
          root: {
            type: 'root',
            direction: 'ltr',
            format: '',
            indent: 0,
            version: 1,
            children: [
              {
                type: 'heading',
                tag: 'h2',
                direction: 'ltr',
                format: '',
                indent: 0,
                version: 1,
                children: [{ type: 'text', text: 'The underground, online.', version: 1, detail: 0, format: 0, mode: 'normal', style: '' }],
              },
              {
                type: 'paragraph',
                direction: 'ltr',
                format: '',
                indent: 0,
                version: 1,
                children: [
                  {
                    type: 'text',
                    text: 'This post was authored in the Payload admin with Lexical and published to the Next.js blog at blog.dvntapp.live — no conversion loss, full SEO, live preview.',
                    version: 1,
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                  },
                ],
              },
            ],
          },
        },
      } as any,
    })
  }

  // Demo comments on the welcome post (threaded), if the collection exists.
  try {
    const post = (await payload.find({ collection: 'posts', where: { slug: { equals: 'welcome-to-the-deviant-blog' } }, limit: 1 })).docs[0]
    const existingComments = await payload.count({ collection: 'comments', overrideAccess: true }).catch(() => ({ totalDocs: 1 }))
    if (post && existingComments.totalDocs === 0) {
      const top = await payload.create({
        collection: 'comments',
        overrideAccess: true,
        data: { post: post.id, authorMember: created[0].id, body: 'First! The dark theme on this blog is gorgeous.', status: 'visible' },
      })
      await payload.create({
        collection: 'comments',
        overrideAccess: true,
        data: { post: post.id, authorMember: created[6].id, parent: top.id, body: 'Agreed — and threaded replies work too.', status: 'visible' },
      })
      await payload.create({
        collection: 'comments',
        overrideAccess: true,
        data: { post: post.id, authorMember: created[2].id, body: 'Can the app session post here directly?', status: 'visible' },
      })
    }
  } catch {
    /* comments collection not migrated yet */
  }

  const counts = {
    members: (await payload.count({ collection: 'members', overrideAccess: true })).totalDocs,
    events: (await payload.count({ collection: 'events', overrideAccess: true })).totalDocs,
    reports: (await payload.count({ collection: 'reports', overrideAccess: true })).totalDocs,
    posts: (await payload.count({ collection: 'posts', overrideAccess: true })).totalDocs,
    comments: await payload.count({ collection: 'comments', overrideAccess: true }).then((r) => r.totalDocs).catch(() => 0),
  }
  console.log('demo seed complete:', counts)
  process.exit(0)
}
run().catch((e) => { console.error(e); process.exit(1) })
