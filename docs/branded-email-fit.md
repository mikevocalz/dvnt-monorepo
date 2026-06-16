# Branded Transactional Emails — fit audit (PROMPT 11)

Goal: every transactional email DVNT sends should look like the landing page —
dark, glassy, brand gradient, DVNT wordmark — instead of the current plain
black-background / system-font / one-line-footer treatment. Email HTML is its
own discipline (tables, inline CSS, image logo, VML buttons), so the web CSS is
*translated*, not pasted.

## Where email actually lives

App is the **dvnt-monorepo**. All edge functions live under
`apps/mobile/supabase/functions/`. The egress is Resend
(`https://api.resend.com/emails`).

There were **three** ways HTML reached Resend before this change:

| Path | File | Wrapper used | Notes |
|------|------|--------------|-------|
| Shared sender | `_shared/send-resend-email.ts` → `sendResendEmail()` + `brandEmailWrapper()` | `brandEmailWrapper` | The intended single egress. |
| Better Auth | `auth/index.ts` → private `sendEmail()` + private `baseWrapper()`/`ctaButton()` | its own `baseWrapper` (a near-duplicate) | reset-password, verify-email, welcome, `/auth/send-welcome`. **Did not** use the shared wrapper. |
| Payout statement | `payouts-release/index.ts` → inline `fetch()` to Resend | **none** (raw `<h2>`/`<p>` string) | Fourth egress; fully unbranded. |

Plus dead code: `send-email/index.ts` (its header comment says "DEAD CODE — no
caller; Better Auth handles transactional email directly"). It carries a third
copy of `baseWrapper`/`ctaButton`.

`event-broadcast-message/index.ts` does **not** email — it writes an in-app
notification + Expo push only. No template is owed there; noted so a future
reader doesn't go looking for a broadcast email send.

## As-is `brandEmailWrapper`

```text
<body bg #000, system font>
  <div max-width:520px; padding:32px 20px>
    {content}
    <hr #27272a>
    <p #52525b 12px center>DVNT · Where nightlife meets culture</p>
```

No `<table>` shell, no logo, no card, no gradient, no `color-scheme`, no VML.
Outlook would collapse the `max-width` div; dark-mode clients can invert the
near-black into mush. The auth `baseWrapper` is the same shape at 480px.

## Live inner-HTML payloads (kept, only restyled)

- **rsvp-verify** — 6-digit OTP. `<h1>Confirm your RSVP</h1>` + a 40px
  letter-spaced cyan code + expiry line. **This is the real "code email."**
- **rsvp-issue-guest** — guest RSVP confirmation, "You're in", N tickets, deep
  link to view tickets, "create an account" nudge.
- **stripe-webhook** — paid ticket confirmation: per-ticket QR (qrserver.com),
  qr_token text, event title/date/location, "show this at the door."
- **auth** — reset-password / verify-email (both **link**-based, not codes) +
  welcome.
- **payouts-release** — host payout statement (gross/refunds/fee/net).

## Design language → email-safe translation

Source tokens (`packages/app/features/screens/landing/theme.ts`,
`apps/mobile/lib/theme/tier-colors.ts`, `DVNT-logo-grad-white.svg`):

- near-black canvas, brand teal-blue ramp `#0f4961→#379ed8` (the wordmark's own
  gradient stops `#175b7b…#2f8ec1`) + purple ramp `#874e9f→#5b2c81`, cyan accent
  `#3FDCFF`, white DVNT wordmark.
- Tier accents (canonical): free `#3FDCFF`, ga `#34A2DF`, vip `#8A40CF`, table
  `#FF5BFC`.

Email can't blur/animate, so:

- **Layout** — centered 600px `<table>`, `background:#0a0a0a`, a rounded card
  (`border-radius:16px`, panel `#0f0f12`, `1px solid #1f1f23`). All CSS inline.
- **Header** — the DVNT gradient wordmark as a hosted PNG (`width`/`height`/`alt`
  so it degrades to "DVNT" text when images are blocked) on near-black, with a
  thin gradient rule under it.
- **CTA** — bulletproof button: VML fill for Outlook + `background-image`
  gradient with a solid `#379ed8` fallback for clients that drop gradients.
- **Type** — Inter/web-safe stack for body (≥16px, `#a1a1aa` on dark), white
  headings; display face is a `@font-face` progressive enhancement only.
- **Dark mode** — `color-scheme` + `supported-color-schemes: dark` meta so mail
  clients don't auto-invert the brand.
- **Footer** — wordmark glyph + "© Deviant LLC · Counter Culture Society" +
  Privacy/FAQ links (dvntapp.live), replacing the one-line text footer.

## The kit (single source — `_shared/email/`)

```text
_shared/email/
├── tokens.ts      hex ramps, fonts, hosted logo/glyph URLs, spacing
├── components.ts  button, codeBlock, card, divider, heading, paragraph,
│                  infoRow, tierBadge, eventHeader, qrBlock
├── wrapper.ts     brandEmailWrapper(inner, opts?) — doctype, table shell,
│                  header logo, gradient rule, footer
└── templates.ts   verificationCode, ticketConfirmation, broadcast,
                   payoutStatement, welcome, resetPassword, verifyEmailLink
```

`send-resend-email.ts` re-exports `brandEmailWrapper` from `email/wrapper.ts`, so
every existing `import { sendResendEmail, brandEmailWrapper }` call site keeps
working and automatically gets the new shell. **One sender, one wrapper.**

## Adoption map

| Call site | Template adopted |
|-----------|------------------|
| `rsvp-verify` | `verificationCode(code, { expiryMin })` |
| `rsvp-issue-guest` | `ticketConfirmation(...)` (guest variant) |
| `stripe-webhook` | `ticketConfirmation(...)` (paid + QR) |
| `auth` (reset/verify/welcome) | `resetPassword` / `verifyEmailLink` / `welcome` — via shared kit, private `baseWrapper` removed |
| `payouts-release` | `payoutStatement(...)` routed through `sendResendEmail` (kills the 4th egress) |
| `send-email` (dead) | re-pointed to the kit so no stale wrapper drifts |
| `event-broadcast-message` | n/a — does not email |

## Logo hosting

White-gradient wordmark + glyph, referenced by absolute https URL with
`width`/`height`/`alt="DVNT"`:

- `dvnt-email-logo@2x.png` — retina wordmark (from `DVNT-logo-grad-white.png`,
  resized to 540×207)
- `dvnt-email-glyph.png` — footer glyph (from app icon, 144×144)

**Live host (chosen): the public `assets` Supabase Storage bucket.** Both PNGs
live at `assets/email/` and resolve at:

```text
https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/email/dvnt-email-logo@2x.png
https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/email/dvnt-email-glyph.png
```

That storage base is the default `ASSET_BASE` in `tokens.ts`, so the logo renders
out of the box with no extra config. A mirror copy also sits in
`apps/web/public/` for a future `dvntapp.live` web deploy. The base URL is
overridable per-environment via the `EMAIL_ASSET_BASE` edge secret (point it at
`https://dvntapp.live` once the web app deploys, if you'd rather serve from
there).

Upload command (Supabase CLI, project linked):

```bash
supabase storage cp apps/web/public/dvnt-email-logo@2x.png \
  ss:///assets/email/dvnt-email-logo@2x.png --linked --experimental
supabase storage cp apps/web/public/dvnt-email-glyph.png \
  ss:///assets/email/dvnt-email-glyph.png --linked --experimental
```

## Prompt 11B — auth lifecycle emails (welcome / verify / reset)

Copy preserved verbatim (title-case H1s + CTAs restored to match the established
voice: `Welcome to DVNT 🎉`, `Confirm Your Email` / `Confirm Email`, `Reset Your
Password` / `Reset Password`); every reassurance ("if you didn't request this…")
and the copy-the-raw-link escape hatch are kept. Only the design changed. The
three templates are `welcome()`, `verifyEmailLink()` (aliased `verifyEmail`), and
`resetPassword()`; `auth/`'s three send sites import them.

### Bug 1 — duplicate welcome (FIXED)

Welcome was sent **twice** for email/password signups: once by Better Auth's
`databaseHooks.user.create.after` (server-side) and again by the client
(`SignUpStep2.tsx` → `POST /auth/send-welcome`). OAuth (Apple/Google) signups got
only the hook.

- **Canonical = the `user.create.after` hook** — it fires server-side for *every*
  signup method, so it's the single source.
- The `/auth/send-welcome` endpoint is **neutered to a no-op** (returns 200 so
  shipped app builds that still call it don't error/retry — but it no longer
  sends).
- The client `fetch('/send-welcome')` call was removed from **both**
  `SignUpStep2.tsx` copies (`apps/mobile/components/...` and
  `packages/app/components/...`).

### Bug 2 — `fixEmailUrl` link round-trip (VERIFIED OK)

`fixEmailUrl` rewrites the Better Auth link to the mounted edge path and appends
the Supabase `apikey` (the gateway 401s browser GETs without it — confirmed).
Tested against the live function:

- Reset request endpoint is `POST …/api/auth/request-password-reset` → `200`
  (sends). `forget-password` is gone in this Better Auth version.
- Reset link shape is a **path segment** `…/api/auth/reset-password/<token>` →
  `302` redirect to `dvnt://reset-password/?error=INVALID_TOKEN` for a bad token
  (a valid token redirects clean into the app). The earlier `?token=` query form
  404s — that's the wrong shape, not a broken route.
- `…/api/auth/verify-email?token=…` → reached (`401` on a bad token).

Verdict: the rewriting resolves and round-trips to the `dvnt://` deep link. (Web
reset needs the client to pass a web `callbackURL` instead of the `dvnt://`
scheme — app-client concern, not the email.)

### Bug 3 — sender domain (LAUNCH BLOCKER)

`RESEND_FROM_EMAIL=DVNT <onboarding@resend.dev>` — the Resend **sandbox** domain.
Consequences: (1) Resend test mode only delivers to the account owner
`devianteventsdc@gmail.com`; (2) no SPF/DKIM/DMARC under a DVNT domain → poor
deliverability + an untrusted "via resend.dev" sender for *lifecycle auth mail*.
**Action:** verify a DVNT sending domain at resend.com/domains and set
`RESEND_FROM_EMAIL` to an address on it (e.g. `DVNT <noreply@dvntapp.live>`)
before launch. Until then, real users won't receive auth mail.

## Verification

All 9 templates (code / single-ticket / multi-ticket / guest-free / broadcast /
payout / welcome / reset / verify-link) were rendered to HTML and screenshotted
via headless Chromium. Every edited file passes an esbuild parse.

Verified locally (`/tmp/email-preview/`):

- [x] valid doctype + `color-scheme`/`supported-color-schemes: dark` on every template
- [x] table-only structure — no `display:flex`/`grid` anywhere
- [x] logo `<img>` carries `width`/`height`/`alt="DVNT"` (renders the wordmark
      with the asset base set; degrades to "DVNT" text when images blocked —
      confirmed in the headless render with no network)
- [x] gradient CTA emits the VML `<v:roundrect>` Outlook fallback (welcome /
      reset / verify-link / broadcast)
- [x] OTP code is real selectable text (not an image), large + letter-spaced
- [x] multi-ticket lists every ticket with the correct tier-badge gradient
      (GA blue, VIP purple, TABLE magenta) + per-tier accent border
- [x] branded footer (glyph + © Deviant LLC · Counter Culture Society + links)
      replaces the old one-line text footer on every email

Remaining for a real-client pass (needs deployed assets + accounts):

- [ ] **Deploy the logo assets**: ship `apps/web/public/dvnt-email-logo@2x.png`
      + `dvnt-email-glyph.png` so `https://dvntapp.live/...` resolves (or set the
      `EMAIL_ASSET_BASE` edge env var to wherever they're hosted).
- [ ] Litmus / Email-on-Acid pass across Apple Mail, Gmail web + app, Outlook
      (the VML button is specifically for Outlook).
- [ ] Confirm dark-mode clients don't invert the brand on real devices.
