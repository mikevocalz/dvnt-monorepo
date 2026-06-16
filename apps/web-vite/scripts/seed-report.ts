// scripts/seed-report.ts — a demo/fake report against an Apple-review account so
// the moderation Reports queue has something to act on. Idempotent.
import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'

async function run() {
  const payload = await getPayload({ config })

  const ensureMember = async (username: string, email: string, status = 'active') => {
    const existing = await payload.find({ collection: 'members', where: { username: { equals: username } }, limit: 1, overrideAccess: true })
    if (existing.totalDocs) return existing.docs[0]
    return payload.create({ collection: 'members', data: { username, email, status }, overrideAccess: true })
  }

  // The Apple review account + a plausible reporter.
  const reported = await ensureMember('appreviewer', 'appreview@dvntapp.live', 'under_review')
  const reporter = await ensureMember('nova_reyes', 'nova@example.com')

  const existing = await payload.find({
    collection: 'reports',
    where: { and: [{ reportedMember: { equals: reported.id } }, { category: { equals: 'spam' } }] },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.totalDocs === 0) {
    await payload.create({
      collection: 'reports',
      overrideAccess: true,
      data: {
        reportedMember: reported.id,
        reporter: reporter.id,
        category: 'spam',
        reason: 'Posting repeated promotional links in event comments',
        details: 'User dropped the same ticket-resale link across 4 different event threads within an hour.',
        status: 'open',
      },
    })
    await payload.create({
      collection: 'reports',
      overrideAccess: true,
      data: {
        reportedMember: reported.id,
        reporter: reporter.id,
        category: 'harassment',
        reason: 'Targeted DMs after being declined',
        status: 'open',
      },
    })
    console.log('created 2 demo reports against appreviewer')
  } else {
    console.log('demo reports already exist')
  }
  const count = (await payload.count({ collection: 'reports', overrideAccess: true })).totalDocs
  console.log('reports total:', count)
  process.exit(0)
}
run().catch((e) => { console.error(e); process.exit(1) })
