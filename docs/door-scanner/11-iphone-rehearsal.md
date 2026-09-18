# 11 — iPhone rehearsal (WS-4)

The one pass nothing automated can stand in for. Playwright cannot fake a
camera in WebKit, so everything below is untested until a person holds a phone
at the door URL. `09-test-plan.md` lists these as the only uncovered risks.

## Pre-flight — done from the shell, no phone needed

Verified 2026-09-18 against production:

| Check | Result |
|---|---|
| `/vendor/zxing/3.1.0/zxing_reader.wasm` on `dvntapp.live` | 200, `application/wasm`, 1,089,670 bytes |
| same on `www.dvntapp.live` | 200, `application/wasm`, 1,089,670 bytes |

The MIME type matters on its own: Safari refuses a WASM module served as
`application/octet-stream`, and the failure surfaces as `classifyCameraError`'s
`engine` state, not as a 404. Both domains are correct, so the self-hosted path
is what an iPhone will load — the jsDelivr fallback should never fire, and if
it does, something changed.

Still unproven, and only a phone can prove it: that the module *instantiates*
and decodes under WebKit. Serving the right bytes is necessary, not sufficient.

## The pass

URL: `https://dvntapp.live/feed/events/<EVENT_ID>/scanner`, in **Safari**, over
https. Signed in as an account with the door role on that event.

1. **Cold load.** Camera permission prompt appears; allow. Frames arrive.
2. **Decode.** Hold a real ticket QR up — off a second phone's screen is fine.
   Expect a verdict card, and the guest's count to move.
3. **One code is one check-in.** Keep the same code in frame for ~5 seconds.
   Exactly one check-in, not a burst. (`scan-gate.ts` is unit-pinned for this;
   this confirms it holds against expo-camera's real 300ms loop.)
4. **Already scanned.** Present the same code again after the card clears.
   Amber, and the title must not read like a server failure.
5. **Backgrounding.** Home-swipe out, wait 3 seconds, come back. The stream
   rebuilds itself — the `visibilitychange`/`pageshow` recovery in
   `QrScanner.web.tsx` step 2, on a 1.5s threshold. A black frame here is the
   headline bug of the whole rehearsal.
6. **Lock and unlock.** Same expectation as 5.
7. **Wake Lock.** Leave it idle 40 seconds without touching the screen. It
   should not dim to lock. iOS supports Screen Wake Lock from 16.4; below that
   it silently no-ops and the screen will sleep.
8. **Offline queue.** Airplane mode, scan, expect the queued state; restore the
   connection, confirm it drains.
9. **Home-Screen web app.** Add to Home Screen, open from the icon, sign in
   again. Its storage is a separate jar — the door role has to be re-confirmed
   there, and `confirmed-door-role.ts` treats a never-confirmed device as
   unauthorised. Decide before doors whether staff use Safari or the icon;
   do not let them mix.
10. **`?engine=legacy`.** Append it and confirm the legacy scanner loads. This
    is the kill-switch; a door with no rehearsed kill-switch does not have one.

## Expected on iPhone, not bugs

- **No torch button, no zoom button.** iOS Safari does not report `torch` or
  `zoom` in `getCapabilities()`, so `caps.torch`/`caps.zoom` stay false and the
  control row (QrScanner.web.tsx:428) does not render at all. Android Chrome
  shows both. If the venue is dark enough to need torch, that is a product gap
  to raise, not a defect to chase on the night.
- **A ~200ms stall on the first decode.** WASM init. Measured 198ms, then
  ~3ms/frame.

## If it fails

Typed codes work in every failure state — that is the fallback, and staff
should be told it exists before they need it. `?engine=legacy` is the second.
Both are on the same page; neither needs a deploy.
