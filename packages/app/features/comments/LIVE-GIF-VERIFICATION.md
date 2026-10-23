# Web GIF release verification

## Incident: 2026-10-23

The mobile and web clients share the Klipy API module, but their build environments
are separate. The production Vercel project had no `EXPO_PUBLIC_KLIPY_API_KEY`.
The deployed browser module consequently read an empty process environment and
returned the explicitly labeled Noto fallback without contacting Klipy. Mocked
provider tests cannot detect this deployment configuration failure.

The browser tests also resized the layout viewport. That is not equivalent to
mobile Chrome opening a keyboard: the visual viewport may shrink/pan while the
layout viewport and `dvh` stay unchanged. The repair observes visual viewport
geometry and includes a fixed-layout keyboard regression and pre-fix negative control.

## Required release checks

- Verify the intended web application key's platform/domain authorization with
  the provider. Do not assume a mobile key can be reused. Never paste keys into
  tickets, logs, commands, or PRs. Configuring persistent credentials requires
  explicit approval, including that this public client key enters the browser bundle.
- Using only an authorized existing key in the process environment, run
  `node scripts/verify-klipy-provider.mjs`. Missing configuration, provider 204,
  malformed responses and failed media reads must fail, not count fallback as success.
  The output excludes keys, full URLs and raw exceptions. This is HTTP/signature
  verification, not browser CORS, image decoding or comment persistence verification.
- Verify the released browser actually contacts Klipy, decodes preview media and
  searches successfully in mobile Chrome. Do not post production test comments
  without authorization. Preserve the distinction between fixture, browser-network,
  physical-device keyboard and persistence evidence.
- Inspect exact-head Chromium/WebKit keyboard artifacts, including unchanged
  layout height, reduced visual height, nonzero offsetTop, textarea and picker
  visibility, close/reopen, focus and cleanup.

## Static2 compatibility repair

Klipy's documented network hosts include exactly `static.klipy.com`,
`static1.klipy.com` and `static2.klipy.com` (https://docs.klipy.com).
The additive repair expands only that exact host set, not arbitrary subdomains.
Apply only `20261023012510_comment_gif_static2_cdn.sql` after explicit approval,
then deploy both `add-comment` and `get-post-comments` with the matching shared
validator before releasing the web client. Preserve their reviewed admission,
JWT and import settings. No RLS/grant changes, backfill, or security rollback.
The older migrations must not be edited or blanket-pushed again.
