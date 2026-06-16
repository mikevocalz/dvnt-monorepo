import 'dotenv/config'
import { getPayload } from 'payload'
import config from '../src/payload.config'
const payload = await getPayload({ config })
const img = process.env.IMG!
const media = await payload.create({ collection: 'media', filePath: img, data: { alt: 'DVNT — welcome', creditText: 'DVNT' }, overrideAccess: true }).catch((e: any) => { console.error('media upload failed:', e.message); return null })
if (!media) process.exit(1)
console.log('uploaded media id', (media as any).id, (media as any).url || '')
const post = (await payload.find({ collection: 'posts', where: { slug: { equals: 'welcome-to-the-deviant-blog' } }, limit: 1 })).docs[0]
if (post) { await payload.update({ collection: 'posts', id: post.id, data: { coverImage: (media as any).id, meta: { image: (media as any).id } }, overrideAccess: true }); console.log('set cover on post', post.id) }
process.exit(0)
