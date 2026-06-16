// scripts/seed-posts.ts
// Idempotent demo content for the public blog (blog.dvntapp.live / apps/web).
// Seeds two categories, two authors, and three published posts with real
// Lexical content (headings, drop-cap paragraph, pull-quote) so the polished
// index hero + cards and the article page all populate. Re-running upserts by
// slug/name/title — safe to run repeatedly.
//   pnpm --filter web-vite seed:posts
import 'dotenv/config'
import path from 'path'
import { getPayload } from 'payload'
import config from '../src/payload.config'

// Local image assets (committed under scripts/seed-assets) → uploaded to Media.
const asset = (f: string) => path.resolve(process.cwd(), 'scripts/seed-assets', f)
const MEDIA = [
  { key: 'geography', file: 'hero-geography.jpg', alt: 'A crowd lit by stage light on a dark dance floor' },
  { key: 'sound', file: 'hero-sound.jpg', alt: 'A DJ mixing under low light' },
  { key: 'door', file: 'hero-door.jpg', alt: 'A neon-lit doorway at night' },
  { key: 'asha', file: 'avatar-asha.jpg', alt: 'Asha Monroe' },
  { key: 'devon', file: 'avatar-devon.jpg', alt: 'Devon Pierce' },
]
const HERO_BY_SLUG: Record<string, string> = {
  'geography-of-a-dvnt-night': 'geography',
  'sound-as-sanctuary': 'sound',
  'the-door-policy-is-care': 'door',
}
const AVATAR_BY_NAME: Record<string, string> = {
  'Asha Monroe': 'asha',
  'Devon Pierce': 'devon',
}

// ─── Lexical helpers ────────────────────────────────────────────────────────
const t = (text: string) => ({
  detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1,
})
const p = (text: string) => ({
  children: [t(text)], direction: 'ltr', format: '', indent: 0,
  type: 'paragraph', version: 1, textFormat: 0, textStyle: '',
})
const h = (tag: 'h2' | 'h3', text: string) => ({
  children: [t(text)], direction: 'ltr', format: '', indent: 0,
  type: 'heading', tag, version: 1,
})
const quote = (text: string) => ({
  children: [t(text)], direction: 'ltr', format: '', indent: 0,
  type: 'quote', version: 1,
})
const doc = (children: unknown[]) => ({
  root: { children, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
})

// ─── Content ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { title: 'Culture', slug: 'culture', accentColor: '#379ed8', order: 1 },
  { title: 'Nightlife', slug: 'nightlife', accentColor: '#874e9f', order: 2 },
]

const AUTHORS = [
  { name: 'Asha Monroe', role: 'Editor-at-Large', bio: 'Asha covers queer nightlife, sound, and the architecture of the after-hours.', socials: { instagram: '@ashamonroe' } },
  { name: 'Devon Pierce', role: 'Staff Writer', bio: 'Devon writes about community, care, and the people who hold the door.', socials: { instagram: '@devonpierce' } },
]

type Seed = {
  slug: string
  title: string
  eyebrow: string
  excerpt: string
  category: string
  author: string
  flags: { featured?: boolean; editorsPick?: boolean; trending?: boolean }
  readTime: number
  daysAgo: number
  content: unknown[]
}

const POSTS: Seed[] = [
  {
    slug: 'geography-of-a-dvnt-night',
    title: 'After Hours: The Geography of a DVNT Night',
    eyebrow: 'Culture',
    excerpt: 'A night does not happen all at once. It moves through rooms, through bodies, through the slow architecture of who gets to feel safe and when.',
    category: 'Culture', author: 'Asha Monroe',
    flags: { featured: true, editorsPick: true },
    readTime: 7, daysAgo: 1,
    content: [
      p('A night does not happen all at once. It builds — room by room, body by body — until the floor finally agrees on a single pulse. By us, for us, and on our own terms, the geography of a DVNT night is something you learn by walking it.'),
      h('h2', 'The Threshold'),
      p('Everything begins at the door. Not the velvet-rope theater of exclusivity, but a quieter negotiation: who is held, who is hurried, who is asked one too many questions. The threshold is where the night decides what kind of night it wants to be.'),
      quote('Safety is not a vibe you add at the end. It is the load-bearing wall the whole room stands on.'),
      h('h2', 'The Floor'),
      p('Past the threshold, the floor takes over. Sound stops being something you hear and becomes something you stand inside. The best rooms are not the loudest — they are the ones where the bass leaves enough room for you to disappear and be found again in the same breath.'),
      h('h2', 'The Last Hour'),
      p('And then the slow exhale. The last hour is the most honest one: makeup melted, guards down, the people who stayed becoming, briefly, the people who matter. The night ends, but the geography stays mapped in you until the next one.'),
    ],
  },
  {
    slug: 'sound-as-sanctuary',
    title: 'Sound as Sanctuary',
    eyebrow: 'Nightlife',
    excerpt: 'How a sound system becomes a sacred object — and why the people behind the booth are doing more than playing records.',
    category: 'Nightlife', author: 'Devon Pierce',
    flags: { editorsPick: true, trending: true },
    readTime: 5, daysAgo: 4,
    content: [
      p('There is a moment, usually somewhere after two in the morning, when a room stops being a venue and becomes a sanctuary. It is rarely planned. It is almost always built on sound.'),
      h('h2', 'Tuning the Room'),
      p('A great selector reads a crowd the way a pastor reads a congregation — not by what they say, but by how they breathe. The set is a conversation, and the best ones leave space for the room to answer back.'),
      quote('We are not here to perform for you. We are here to remember something with you.'),
      h('h2', 'The People Behind the Booth'),
      p('Behind every transcendent night is a stack of unglamorous labor: the rig hauled up three flights, the cables taped down, the sound checked while the room is still empty and honest. Care is infrastructure. It just rarely gets a credit.'),
    ],
  },
  {
    slug: 'the-door-policy-is-care',
    title: 'The Door Policy Is Care',
    eyebrow: 'Culture',
    excerpt: 'A door is not a filter. In the right hands, it is the first and most important act of hospitality a night can offer.',
    category: 'Culture', author: 'Asha Monroe',
    flags: { trending: true },
    readTime: 4, daysAgo: 8,
    content: [
      p('We talk about door policy like it is a bouncer with a clipboard and a bad attitude. But the door is the first promise a party makes — and the easiest one to break.'),
      h('h2', 'Who Gets Held'),
      p('A good door is not looking for reasons to keep you out. It is looking for ways to keep everyone inside safe. Those are different jobs, and they require different people — people who understand that hospitality and protection are the same gesture pointed in two directions.'),
      quote('The most radical thing a party can say is: you are welcome here, and we will make sure you stay that way.'),
      p('Get the door right and the rest of the night has a foundation. Get it wrong and no amount of sound or light can put back what was lost at the threshold.'),
    ],
  },
]

// ─── Run ────────────────────────────────────────────────────────────────────
async function run() {
  const payload = await getPayload({ config })

  // ── Media first (so authors/posts can reference it) ──────────────────────
  const mediaIds: Record<string, string | number> = {}
  for (const m of MEDIA) {
    const existing = await payload.find({ collection: 'media', where: { alt: { equals: m.alt } }, limit: 1, overrideAccess: true })
    if (existing.totalDocs > 0) {
      mediaIds[m.key] = existing.docs[0].id
    } else {
      const doc = await payload.create({ collection: 'media', data: { alt: m.alt }, filePath: asset(m.file), overrideAccess: true })
      mediaIds[m.key] = doc.id
      console.log(`uploaded media: ${m.file}`)
    }
  }

  const findOrCreate = async (collection: string, where: any, data: any) => {
    const existing = await payload.find({ collection: collection as any, where, limit: 1, overrideAccess: true })
    if (existing.totalDocs > 0) {
      // Keep avatars/accent in sync on re-run.
      const updated = await payload.update({ collection: collection as any, id: existing.docs[0].id, data, overrideAccess: true })
      return updated
    }
    const created = await payload.create({ collection: collection as any, data, overrideAccess: true })
    console.log(`created ${collection}: ${data.title ?? data.name}`)
    return created
  }

  const catIds: Record<string, string | number> = {}
  for (const c of CATEGORIES) {
    const doc = await findOrCreate('categories', { slug: { equals: c.slug } }, c)
    catIds[c.title] = doc.id
  }

  const authorIds: Record<string, string | number> = {}
  for (const a of AUTHORS) {
    const avatar = mediaIds[AVATAR_BY_NAME[a.name]]
    const doc = await findOrCreate('authors', { name: { equals: a.name } }, { ...a, avatar })
    authorIds[a.name] = doc.id
  }

  for (const post of POSTS) {
    const data: any = {
      title: post.title,
      slug: post.slug,
      eyebrow: post.eyebrow,
      excerpt: post.excerpt,
      heroCaption: '',
      content: doc(post.content),
      heroImage: mediaIds[HERO_BY_SLUG[post.slug]],
      categories: [catIds[post.category]],
      authors: [authorIds[post.author]],
      featured: !!post.flags.featured,
      editorsPick: !!post.flags.editorsPick,
      trending: !!post.flags.trending,
      readTime: post.readTime,
      publishedAt: new Date(Date.now() - post.daysAgo * 86400000).toISOString(),
      _status: 'published',
    }
    const existing = await payload.find({ collection: 'posts', where: { slug: { equals: post.slug } }, limit: 1, overrideAccess: true })
    if (existing.totalDocs > 0) {
      await payload.update({ collection: 'posts', id: existing.docs[0].id, data, overrideAccess: true })
      console.log(`updated post: ${post.slug}`)
    } else {
      await payload.create({ collection: 'posts', data, overrideAccess: true })
      console.log(`created post: ${post.slug}`)
    }
  }

  console.log('\nSeed complete. Published posts:')
  const all = await payload.find({ collection: 'posts', where: { _status: { equals: 'published' } }, limit: 50, overrideAccess: true })
  console.log(all.docs.map((d: any) => `  • ${d.slug} (featured=${d.featured}, editorsPick=${d.editorsPick}, trending=${d.trending})`).join('\n'))
  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
