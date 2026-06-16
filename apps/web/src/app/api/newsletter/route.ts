// src/app/api/newsletter/route.ts
// Adds subscriber to Resend audience and sends a welcome email.
// Env vars required:
//   RESEND_API_KEY        — your Resend secret key
//   RESEND_AUDIENCE_ID    — Resend audience/list ID (create one in the Resend dashboard)
//   RESEND_FROM_EMAIL     — verified sender, e.g. "DVNT Dispatch <dispatch@dvntapp.live>"
import { NextResponse } from 'next/server'
import { Resend } from 'resend'

// NOTE: do NOT construct Resend at module top-level — `new Resend(undefined)`
// throws "Missing API key" and that runs at build time when Next collects route
// data (no env yet), failing the build. Construct it lazily inside the handler
// after the key check below.
const FROM = process.env.RESEND_FROM_EMAIL ?? 'DVNT Dispatch <onboarding@resend.dev>'
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID ?? ''

export async function POST(req: Request) {
  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 422 })
  }

  if (!process.env.RESEND_API_KEY) {
    // Dev fallback: log and return success so the UI works without keys
    console.warn('[newsletter] RESEND_API_KEY not set — skipping send')
    return NextResponse.json({ ok: true, dev: true })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)

  try {
    // 1. Add contact to audience (idempotent — Resend dedupes by email)
    if (AUDIENCE_ID) {
      await resend.contacts.create({
        email,
        audienceId: AUDIENCE_ID,
        unsubscribed: false,
      })
    }

    // 2. Send welcome email
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: 'Welcome to DVNT Dispatch ✦',
      html: welcomeHtml(email),
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[newsletter] Resend error', err)
    return NextResponse.json(
      { error: err?.message ?? 'Failed to subscribe' },
      { status: 500 },
    )
  }
}

function welcomeHtml(email: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Welcome to DVNT Dispatch</title>
</head>
<body style="margin:0;padding:0;background:#02030A;font-family:system-ui,-apple-system,sans-serif;color:#FAFAF9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#02030A;padding:48px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="padding:0 32px 32px;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0;font-size:11px;font-family:ui-monospace,monospace;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.35);">DVNT Magazine</p>
            <h1 style="margin:12px 0 0;font-size:36px;font-weight:900;letter-spacing:-0.04em;line-height:1.1;background:linear-gradient(135deg,#3FDCFF,#FF5BFC);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">You&rsquo;re in the loop.</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:rgba(245,245,244,0.8);">
              The DVNT Dispatch is your direct line to nightlife culture, event guides, creator features, and editorial you won&rsquo;t find in the algorithm.
            </p>
            <p style="margin:0 0 32px;font-size:15px;line-height:1.65;color:rgba(245,245,244,0.55);">
              By us, for us &mdash; unapologetically Black, queer, and loud.
            </p>
            <a href="https://dvntapp.live/posts" style="display:inline-block;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#FF5BFC,#8A40CF);color:#fff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">Read the latest →</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px 0;border-top:1px solid rgba(255,255,255,0.07);">
            <p style="margin:0;font-size:11px;color:rgba(245,245,244,0.25);font-family:ui-monospace,monospace;line-height:1.7;">
              You&rsquo;re receiving this because ${email} subscribed to DVNT Dispatch.<br/>
              <a href="https://dvntapp.live" style="color:rgba(63,220,255,0.6);text-decoration:none;">dvntapp.live</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
