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
these.

**The self-hosted WASM path on Chrome.** Chrome ships a native
`BarcodeDetector` with `qr_code`, so it never loads our WASM. The e2e deletes
the native detector to force the fallback, which proves the fallback works —
not that the iPhone path works. That needs the rehearsal phone.

**Decode quality.** The `06` lab covers inverted, dim, blurry and small codes;
it has NOT been re-run, on the evidence that `packages/ui/src/media/qr/` is
byte-identical to what its 8/8 was measured against. The e2e uses one clean
code.

**Undo.** There is no undo on a check-in, from the camera or the list. Nothing
tests it because nothing implements it.

**Load.** No test drives 100+ sequential scans. The `04` harness covers the
server CAS under concurrency; the client has not been run at door volume.
