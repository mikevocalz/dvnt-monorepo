// src/collections/hooks/event.ts
// Write Payload Events edits back to the live app row (public.events). Events
// link to the app by `appEventId` = public.events.id. We mirror the SAFE field
// set the console edit endpoint already writes (title/dates/capacity/location)
// plus description — deliberately NOT `status`, which is derived from the app's
// visibility state machine and would drift if written naively.
import type { CollectionAfterChangeHook } from 'payload'

let pool: any = null
async function appPool(): Promise<any> {
  const url = process.env.APP_DATABASE_URL
  if (!url) return null
  if (!pool) {
    const pg: any = await import('pg')
    const Pool = pg.default?.Pool ?? pg.Pool
    pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

// Payload field → [public.events column, transform]
const FIELD_MAP: Array<[string, string, (v: any) => any]> = [
  ['title', 'title', (v) => v],
  ['description', 'description', (v) => v],
  ['location', 'location_name', (v) => v],
  ['startsAt', 'start_date', (v) => v],
  ['endsAt', 'end_date', (v) => v],
  ['capacity', 'max_attendees', (v) => (v == null ? null : Number(v))],
]

// Flyer/cover replace: a new image uploaded to Events `coverUpload` is published
// to public.media and public.events.cover_image_id is repointed.
const relId = (v: any): number | undefined => {
  if (v == null) return undefined
  return Number(typeof v === 'object' ? v.id : v)
}

export const onEventCoverChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'update') return doc
  if ((context as any)?.skipEventWriteBack) return doc
  const uploadId = relId((doc as any).coverUpload)
  const prevUploadId = relId((previousDoc as any)?.coverUpload)
  if (!uploadId || uploadId === prevUploadId) return doc
  const appEventId = doc?.appEventId
  if (!appEventId) return doc

  let media: any = typeof (doc as any).coverUpload === 'object' ? (doc as any).coverUpload : null
  if (!media?.url) {
    media = await req.payload.findByID({ collection: 'media', id: uploadId, overrideAccess: true }).catch(() => null)
  }
  if (!media?.url) return doc
  const origin = (process.env.BLOG_ORIGIN || process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, '')
  const url = /^https?:\/\//.test(media.url) ? media.url : `${origin}${media.url}`

  const p = await appPool()
  if (!p) return doc
  try {
    const ins = await p.query(`insert into public.media (url) values ($1) returning id`, [url])
    const mediaId = ins.rows[0]?.id
    await p.query(`update public.events set cover_image_id = $1, updated_at = now() where id = $2`, [mediaId, Number(appEventId)])
    req.payload?.logger?.info?.(`[event] flyer replaced for events.id=${appEventId} -> media ${mediaId}`)
  } catch (e: any) {
    req.payload?.logger?.error?.(`[event] flyer replace failed for ${appEventId}: ${e?.message}`)
  }
  return doc
}

export const onEventChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
  context,
}) => {
  if (operation !== 'update') return doc
  if ((context as any)?.skipEventWriteBack) return doc
  const appEventId = doc?.appEventId
  if (!appEventId) return doc

  const sets: string[] = []
  const vals: any[] = []
  let i = 1
  for (const [field, col, xf] of FIELD_MAP) {
    if ((doc as any)[field] !== (previousDoc as any)?.[field]) {
      sets.push(`${col} = $${i++}`)
      vals.push((doc as any)[field] == null ? null : xf((doc as any)[field]))
    }
  }
  if (!sets.length) return doc

  const p = await appPool()
  if (!p) {
    req.payload?.logger?.warn?.('[event] APP_DATABASE_URL not set — cannot write event back')
    return doc
  }
  vals.push(Number(appEventId))
  try {
    await p.query(
      `update public.events set ${sets.join(', ')}, updated_at = now() where id = $${i}`,
      vals,
    )
    req.payload?.logger?.info?.(`[event] wrote ${sets.length} field(s) to events.id=${appEventId}`)
  } catch (e: any) {
    req.payload?.logger?.error?.(`[event] write-back failed for ${appEventId}: ${e?.message}`)
  }
  return doc
}
