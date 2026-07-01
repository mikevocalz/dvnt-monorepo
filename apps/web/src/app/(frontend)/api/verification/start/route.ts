// POST /api/verification/start — open a Persona Hosted Flow link for the
// current user and (importantly for I1) write the identity_verifications
// row BEFORE returning the URL.
//
// v0 path uses the GENERIC template-id link:
//   https://inquiry.withpersona.com/verify
//     ?inquiry-template-id=<itmpl_*>
//     &reference-id=<dvnt_user_id>
//     &redirect-uri=<our return url>
//
// Verified surface (from the public hosted-flow doc):
//   - The verify URL host and path.
//   - `inquiry-template-id` (itmpl_*) and `inquiry-id` (inq_*) are the two
//     accepted ways to pin a flow.
//   - `reference-id` is the optional parameter we use to bind the inquiry
//     back to our user_id when the webhook lands.
//
// Trade-off / upgrade path:
//   The generic template-id link does client-side inquiry creation —
//   reloading the link creates a duplicate inquiry. Acceptable for v0
//   because (a) we dedup on `provider_ref` at webhook time and (b) the
//   monotonic guard means the latest terminal event wins. When we
//   verify the Persona REST surface, upgrade to server-side
//   `POST /api/v1/inquiries` and switch to a one-shot `inquiry-id`.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAppUser, getAppDbPool } from '@/lib/verifyAppUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PERSONA_TEMPLATE_ID = process.env.PERSONA_TEMPLATE_ID ?? ''
const PERSONA_VERIFY_URL = 'https://inquiry.withpersona.com/verify'
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

const SESSION_COOKIE_NAMES = ['dvnt-session', 'better-auth.session_token', 'session_token']

async function readSessionToken(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const jar = await cookies()
  for (const name of SESSION_COOKIE_NAMES) {
    const c = jar.get(name)?.value
    if (c) return c
  }
  return null
}

export async function POST(req: Request) {
  if (!PERSONA_TEMPLATE_ID) {
    return NextResponse.json({ error: 'Verification not configured' }, { status: 500 })
  }

  const token = await readSessionToken(req)
  const user = await verifyAppUser(token ?? undefined)
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  let body: { returnPath?: string } = {}
  try {
    body = (await req.json()) as { returnPath?: string }
  } catch {
    // Empty body is fine for this endpoint.
  }
  const returnPath = body.returnPath?.startsWith('/') ? body.returnPath : '/verification/complete'

  // I1 — pre-create the row (status='pending') so a webhook arriving
  // before the user finishes still has a deterministic user_id mapping.
  // provider_ref stays null until we either (a) parse it out of the
  // webhook payload or (b) upgrade to server-side inquiry create.
  const pool = getAppDbPool()
  await pool.query(
    `insert into identity_verifications (user_id, provider, status, last_event_at)
     values ($1, 'persona', 'pending', now())
     on conflict (user_id) do update set
       provider = 'persona',
       status = case
         when identity_verifications.status in ('passed','failed','expired')
           then identity_verifications.status   -- never reopen a terminal state
           else 'pending'
       end,
       updated_at = now()`,
    [user.id],
  )

  const verifyUrl = new URL(PERSONA_VERIFY_URL)
  verifyUrl.searchParams.set('inquiry-template-id', PERSONA_TEMPLATE_ID)
  verifyUrl.searchParams.set('reference-id', user.id)
  verifyUrl.searchParams.set('redirect-uri', `${SITE_URL}${returnPath}`)

  return NextResponse.json({ url: verifyUrl.toString() })
}
