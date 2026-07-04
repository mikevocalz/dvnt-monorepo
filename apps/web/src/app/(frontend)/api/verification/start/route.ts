// POST /api/verification/start — open a Didit hosted verification session for
// the current user and (importantly for I1) write the identity_verifications
// row BEFORE returning the URL.
//
// Didit (free KYC) contract — verified against the official demo
// (github.com/didit-protocol/didit-full-demo, src/app/api/verification/route.ts):
//   POST {DIDIT_BASE_URL}/v3/session/
//     header: X-API-Key: <DIDIT_API_KEY>
//     body:   { workflow_id, vendor_data, callback }
//     -> 201 { session_id, url, status, ... }
//   `vendor_data` is our own user_id — it round-trips back on the webhook so we
//   can bind the decision to the DVNT user (I1). `url` is the hosted flow we
//   redirect the user to. Server-side session create means no duplicate-session
//   problem (unlike Persona's client-side template link).

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAppUser, getAppDbPool } from '@/lib/verifyAppUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DIDIT_API_KEY = process.env.DIDIT_API_KEY ?? ''
const DIDIT_WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID ?? ''
const DIDIT_BASE_URL = (process.env.DIDIT_BASE_URL ?? 'https://verification.didit.me').replace(/\/$/, '')
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
  if (!DIDIT_API_KEY || !DIDIT_WORKFLOW_ID) {
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

  // Create the Didit session first — we need session_id to store as provider_ref.
  // ponytail: hard timeout so a hung Didit API can't freeze the verify UX
  // (mirrors the JWT-bridge fix).
  let session: { session_id?: string; url?: string; status?: string }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    let res: Response
    try {
      res = await fetch(`${DIDIT_BASE_URL}/v3/session/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': DIDIT_API_KEY,
        },
        body: JSON.stringify({
          workflow_id: DIDIT_WORKFLOW_ID,
          vendor_data: user.id,
          callback: `${SITE_URL}${returnPath}`,
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    session = (await res.json()) as { session_id?: string; url?: string; status?: string }
    if (!res.ok || !session?.url || !session?.session_id) {
      const msg =
        (session as { message?: string; error?: string; detail?: string })?.message ??
        (session as { error?: string })?.error ??
        (session as { detail?: string })?.detail ??
        `Didit session create failed (${res.status})`
      console.error('[verification/start] Didit error:', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  } catch (err) {
    console.error('[verification/start] Didit request failed:', err)
    return NextResponse.json({ error: 'Verification provider unavailable' }, { status: 502 })
  }

  // I1 — pre-create the row (status='pending') keyed to session_id so the
  // webhook (which echoes vendor_data + session_id) always has a deterministic
  // user_id mapping. Never reopen a terminal state.
  const pool = getAppDbPool()
  await pool.query(
    `insert into identity_verifications (user_id, provider, provider_ref, status, last_event_at)
     values ($1, 'didit', $2, 'pending', now())
     on conflict (user_id) do update set
       provider = 'didit',
       provider_ref = $2,
       status = case
         when identity_verifications.status in ('passed','failed','expired')
           then identity_verifications.status   -- never reopen a terminal state
           else 'pending'
       end,
       updated_at = now()`,
    [user.id, session.session_id],
  )

  return NextResponse.json({ url: session.url })
}
