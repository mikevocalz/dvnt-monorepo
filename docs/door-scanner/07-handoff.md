# 07 — Handoff: states, props, timings as built

## `QrScanner` (`packages/ui/src/media/QrScanner.web.tsx`)

| Prop | Type | Notes |
|---|---|---|
| `onScan` | `(text: string) => void` | fires once per presentation, not per decode |
| `onError` | `(message: string) => void` | optional; the component already renders the failure |
| `oneShot` | `boolean` (default `true`) | the door passes `false` |
| `paused` | `boolean` | stops decoding, keeps the stream live |
| `keepAwake` | `boolean` (default `true`) | Screen Wake Lock, re-acquired on visibility |
| `onStatusChange` | `(status, detail?) => void` | `starting · needs_permission · scanning · paused · blocked` |

Marks its root `data-qr-engine="modern" | "legacy"` so which engine is live is
answerable from a phone someone hands you mid-shift.

`?engine=legacy` selects the pre-rewrite html5-qrcode implementation. Statically
imported, because a fallback that needs the network is worthless when the
network is what broke. **Delete it and the `html5-qrcode` dependency in the
first PR after 2026-09-20.**

## Scanner screen (`packages/app/features/events/scanner.web.tsx`)

State is Zustand only — `useScannerStore` (`scanResult`, `scanCount`,
`scanHistory`, `manualToken`, `mode`), `useDoorSyncStore`, `useGuestListStore`,
`useDoorFeedbackStore`. `useRef` holds non-render values only: `cooldownRef`,
`lastScannedRef`, `lastSignalled`.

### Gate

Four outcomes, from `useEventRole` plus the auth store:

- `loading` — spinner. Never refuses during this.
- `signed_out` — "You've been signed out". Sign in returns to **this** door.
- `not_staff` — the server answered no. The only real refusal.
- `cannot_verify` — no answer. Falls through to the scanner when the device has
  **both** a remembered role and downloaded tokens.

Every panel shows the account being refused.

### Verdict card

`data-verdict="success" | "rejected" | "no_verdict"`, `role="status"` for
admitted and `role="alert"` otherwise. `already_scanned` renders the separate
full-viewport `DuplicateFlash`, which carries the same `data-verdict`.

## Timings

| Thing | Value |
|---|---|
| expo-camera decode interval | 300ms (hard-coded upstream) |
| Gate absence window | 1200ms |
| Camera remount after hidden | >1500ms |
| Camera start watchdog | 8s |
| Capability probe | 150ms poll, 4s ceiling |
| Token refresh | 180s |
| Queue drain | 20s while queued, immediate on `online` |
| Roster staleTime | 30s |
| Remembered role | 24h |

## Seams that are not what they look like

Verified against installed expo-camera 57.0.5 (identical to 57.0.3 on these
lines):

- `onCameraReady` fires on **failure** too, and before frames exist —
  `useWebCameraStream.ts:106-107`, `compareStreams(null,null)` is false at
  `WebCameraUtils.ts:199`. Never treat it as "camera is live".
- `zoom={0}` is a **no-op** — `convertNormalizedSetting` opens with
  `if (!value) return;` (`:345`). 1× is `Number.EPSILON`.
- Decode errors are **silently swallowed** — `ExpoCamera.web.tsx:60-66` never
  passes `onError`. A failed WASM load is a live preview that never reads.
- `useCameraPermissions`' web `get` **throws** when `navigator.permissions.query`
  is missing rather than degrading.
- Chrome ships a native `BarcodeDetector` with `qr_code`, so **Chrome never
  touches the self-hosted WASM**. That path is the iPhone path.
