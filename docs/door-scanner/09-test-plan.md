# 09 — Test plan

What is covered, by what, and what is not covered at all.

## Automated

**Unit — 658 tests via `pnpm test`.** The door-specific ones:

| File | Pins |
|---|---|
| `scan-verdict.test.ts` (9) | a rejection and a no-verdict never share a title; every no-verdict opens with "Not checked in"; red titles name the rejection; an unknown token while offline is a no-verdict |
| `scan-gate.test.ts` | one presentation of a code is one scan, with an injected clock |
| `camera-issues.test.ts` | every getUserMedia failure maps to a readable state |
| `confirmed-door-role.test.ts` (6) | who gets in offline: never-confirmed devices do not, roles expire at 24h, corrupt storage reads as unauthorised |

**E2E — 10 specs, against a production build, three consecutive green runs.**
Chrome is pointed at a Y4M of a real QR code, decode-verified through
zxing-wasm before use.

| Spec | Pins |
|---|---|
| decodes and checks in exactly once | the whole chain, and that one held-up code is one check-in |
| stops decoding while a verdict is up | nothing is checked in behind a card |
| `?engine=legacy` | the door's kill-switch actually swaps engines |
| offline queues then drains | the wiring that did not exist on web |
| guest list | name search, counts, and check-in through the same path |
| used ticket vs unreachable server | the two outcomes that must never be confused |
| gate tells three problems apart | 403 vs dead connection render differently |
| dead decode engine | a readable panel, not a black camera |

## Manual, at 375px

`docs/door-scanner/screens/` — admitted, already-scanned, no-verdict,
not-staff, cannot-verify, engine-failed. Captured against a production build at
iPhone width.

## Not covered, and why

**Everything that needs a real device.** Playwright cannot fake a camera in
WebKit, so iOS Safari is untested end to end: the permission prompt, torch and
zoom capability, stream recovery after backgrounding, Wake Lock, and the
Home-Screen web app's separate storage. WS-4 is the only thing that covers
these; the pass is scripted in `11-iphone-rehearsal.md`.

**The self-hosted WASM path on Chrome.** Chrome ships a native
`BarcodeDetector` with `qr_code`, so it never loads our WASM. The e2e deletes
the native detector to force the fallback, which proves the fallback works —
not that the iPhone path works. That needs the rehearsal phone.

**Decode quality — measured directly, 4/4.** Against the same `zxing-wasm`
reader the browser loads, at 640x480:

| Condition | Result | Frame time |
|---|---|---|
| normal | exact token | 198ms (includes WASM init) |
| inverted | exact token | 3.2ms |
| dim + blurry (35% brightness, 2-pass blur) | exact token | 3.5ms |
| small (150px symbol) | exact token | 3.2ms |

~3ms per frame against expo-camera's 300ms interval, so decode is not the
bottleneck at a door.

This measures the DECODER, which is what the `06` lab's 8/8 measures. It does
not replace the lab's other two checks — expo-camera's loop driven in a real
browser, and the CDN fallback when the self-hosted WASM is blocked. The loop is
covered instead by the e2e running against the real mounted route; the CDN
fallback is covered only in the sense that its failure state renders, not that
the CDN itself serves. The lab has NOT been re-run, on the evidence that
`packages/ui/src/media/qr/` is byte-identical to what its 8/8 was measured
against.

**Undo.** There is no undo on a check-in, from the camera or the list. Nothing
tests it because nothing implements it.

**Load.** No test drives 100+ sequential scans. The `04` harness covers the
server CAS under concurrency; the client has not been run at door volume.
