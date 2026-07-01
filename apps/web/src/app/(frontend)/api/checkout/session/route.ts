// POST /api/checkout/session — create a Stripe Checkout session for a
// membership_subscriptions plan_key. Web rail entry point.
//
// Failure mode defended against: I1. The stripe_customers bridge row MUST
// exist before the first webhook fires for this user. We write it here,
// before redirecting to Checkout — even if the user abandons the session
// the row is harmless (no webhook will fire), but if Stripe ever wins the
// race we have a deterministic user_id mapping waiting.
//
// Verified Stripe API surface (https://docs.stripe.com/api):
//   - POST /v1/customers              (form-encoded; metadata[dvnt_user_id])
//   - POST /v1/checkout/sessions      (mode=subscription, line_items[…])
// No Stripe SDK — raw fetch keeps this server bundle small and matches the
// existing supabase edge-fn pattern.

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAppUser, getAppDbPool } from '@/lib/verifyAppUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? ''
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

type CheckoutBody = {
  planKey: string
  successPath?: string
  cancelPath?: string
}

// Best-known session cookie names used by Better Auth in this app. We try
// each in order and fall back to the Authorization header for SSR calls
// from native that already carry the token explicitly.
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

async function stripeForm<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params)
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const json = await res.json()
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

// Look up an existing Stripe customer or create + persist one. Identity
// bridge row (I1) MUST land before this function returns success.
async function getOrCreateStripeCustomer(
  pool: any,
  userId: string,
  email: string | null,
): Promise<string> {
  const existing = await pool.query(
    `select stripe_customer_id from stripe_customers where user_id = $1 limit 1`,
    [userId],
  )
  if (existing.rows[0]?.stripe_customer_id) {
    return String(existing.rows[0].stripe_customer_id)
  }

  const customer = await stripeForm<{ id: string }>('customers', {
    ...(email ? { email } : {}),
    'metadata[dvnt_user_id]': userId,
  })

  // Insert-or-update — concurrent first checkouts won't fight.
  await pool.query(
    `insert into stripe_customers (user_id, stripe_customer_id)
     values ($1, $2)
     on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id`,
    [userId, customer.id],
  )
  return customer.id
}

export async function POST(req: Request) {
  if (!STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const token = await readSessionToken(req)
  const user = await verifyAppUser(token ?? undefined)
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  let body: CheckoutBody
  try {
    body = (await req.json()) as CheckoutBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.planKey || typeof body.planKey !== 'string') {
    return NextResponse.json({ error: 'planKey required' }, { status: 400 })
  }

  const pool = getAppDbPool()

  // Resolve plan_key → stripe_price_env → STRIPE_PRICE_<NAME> env var.
  // membership_plans stores the env var name (not the price id) so price
  // rotation is an env change, not a migration.
  const planRow = await pool.query(
    `select plan_key, product_family, stripe_price_env, active
       from membership_plans
      where plan_key = $1
      limit 1`,
    [body.planKey],
  )
  const plan = planRow.rows[0]
  if (!plan || plan.active === false || !plan.stripe_price_env) {
    return NextResponse.json({ error: 'Plan not purchasable' }, { status: 400 })
  }
  const stripePriceId = process.env[plan.stripe_price_env as string]
  if (!stripePriceId) {
    return NextResponse.json(
      { error: `Stripe price not configured (${plan.stripe_price_env})` },
      { status: 500 },
    )
  }

  let customerId: string
  try {
    customerId = await getOrCreateStripeCustomer(pool, user.id, user.email)
  } catch (err) {
    return NextResponse.json(
      { error: `Customer create failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  const successPath = body.successPath?.startsWith('/') ? body.successPath : '/checkout/success'
  const cancelPath = body.cancelPath?.startsWith('/') ? body.cancelPath : '/pricing'

  let session: { id: string; url: string }
  try {
    session = await stripeForm<{ id: string; url: string }>('checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': stripePriceId,
      'line_items[0][quantity]': '1',
      success_url: `${SITE_URL}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}${cancelPath}`,
      // Webhook metadata lands on both the Session and the Subscription so
      // the stripe-webhook fn finds dvnt_user_id + plan_key regardless of
      // event type.
      'metadata[dvnt_user_id]': user.id,
      'metadata[plan_key]': body.planKey,
      'metadata[product_family]': plan.product_family,
      'subscription_data[metadata][dvnt_user_id]': user.id,
      'subscription_data[metadata][plan_key]': body.planKey,
      'subscription_data[metadata][product_family]': plan.product_family,
      // Pass through to invoice line items for receipt clarity.
      'subscription_data[description]': `DVNT ${plan.product_family} — ${body.planKey}`,
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Checkout session create failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ sessionId: session.id, url: session.url })
}
