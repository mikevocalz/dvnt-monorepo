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
