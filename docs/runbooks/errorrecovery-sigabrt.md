# The `ErrorRecovery.crash()` SIGABRT — what it is and why it stayed unnamed

Builds 1.0.343 through 1.0.349 abort on iOS with `EXC_CRASH (SIGABRT)` and this
`Last Exception Backtrace`:

```
StartupProcedure.throwException(_:)          (StartupProcedure.swift:348)
ErrorRecovery.crash()                        (ErrorRecovery.swift:277)
ErrorRecovery.runNextTask()                  (ErrorRecovery.swift:190)
closure #1 in ErrorRecovery.notify(newRemoteLoadStatus:)  (ErrorRecovery.swift:149)
```

## The abort is a re-raise, not a fault

`ErrorRecovery` is expo-updates' bad-update guard. It hooks `RCTSetFatalHandler`
and `RCTSetFatalExceptionHandler`, and when RN reports a **fatal JS error** it
runs a fixed pipeline: fetch a new update → launch it → fall back to a cached
one → crash. `crash()` is the last rung. It re-raises the *original* error as an
`NSException`.

So the crash is a genuine unhandled JS fatal, wearing expo-updates' clothes.

Two facts narrow it further, both read off the two 1.0.349 reports:

- `runNextTask()` reached `.crash` directly from `notify(...)`, so `.launchCached`
  had already been removed. That happens when the running update's
  `successfulLaunchCount > 0` — expo-updates had concluded this is not a bad
  update, and it was right.
- Timing. Report A: launch 10:20:22.98, abort 10:20:25.83 — **2.85s**, before
  content appeared. Report B: launch 21:12:11.88, abort 21:12:21.81 — **10.0s**,
  which is the window `handleContentDidAppear` keeps the handlers armed for.

In both, the JS thread was alive and executing at the moment of the abort
(report A in `Interpreter::caseIteratorBegin`, report B in
`BCProviderFromSrc::create` under `ModuleHolder.createJavaScriptModuleObject`).
Not a deadlock.

## Why no one could name it

The `.crash` file records the re-raise. The reason string lives in the
`NSException`, which iOS does not put in the report.

Everything needed to capture it was already built:

| Layer | Writes | Read by |
|---|---|---|
| `plugins/with-uncaught-exception-handler.js` | `dvnt-uncaught-exception.json` | `lib/native-exception-log.ts` |
| `lib/global-error-handler.ts` | `DVNT_LAST_JS_ERROR` in MMKV | `lib/native-exception-log.ts` |
| expo-updates `writeErrorOrExceptionToLog` | its own log store | `lib/ota-bootstrap-log.ts` |

All three fed `reportToSentry()`, which opened with:

```ts
const { Sentry } = require("@dvnt/app/lib/sentry-boot");
if (!Sentry?.captureMessage) return;   // web fork / not booted
```

`d00827b` (2026-09-04) removed the mobile Sentry SDK and made
`sentry-boot.native.ts` export `Sentry = undefined`. From that commit on, every
prior-session crash record was read, printed to a console no TestFlight device
surfaces, deleted, and lost — the exact failure the function's own docstring
describes for the 1.0.316 loop. The first crashing build shipped the next day.

`lib/ota-bootstrap-log.ts` had a second, independent gap: it asked expo-updates
for log entries from the last `120_000` ms. Two minutes is shorter than the gap
between a crash and the relaunch that reads it, so it found nothing on precisely
the launches it existed for.

## What changed

- `reportPriorCrash()` (renamed from `reportToSentry`) writes to
  `analytics_events` — the sink the Sentry removal named as the replacement.
  One row per distinct crash signature; the existing `claimCrashSignature`
  dedupe still keeps a relaunch loop to one row.
- The expo-updates log window is 24h, and its `errorRecoveryFatalException`
  entries now report instead of only printing. That entry carries the serialized
  original error — the string the `.crash` file does not have.

## Next occurrence

```sql
select created_at, metadata
from analytics_events
where event = 'prior_session_crash'
order by created_at desc
limit 20;
```

`metadata.kind` is `js`, `native`, or `expo-updates-recovery`.
`metadata.reason` is the thing to read first.

## The capture path was sound — only the transport was dead

Audited 2026-09-09, and this is the reason the fix above is expected to work
rather than hoped to:

- `lib/global-error-handler.ts:177` installs `ErrorUtils.setGlobalHandler` at
  module scope, reached from `_layout.tsx:18` → `lib/native-exception-log.ts` →
  its static import. That is early enough for a t=2.85s fatal.
- Its handler calls `persist()` (a synchronous MMKV write to
  `DVNT_LAST_JS_ERROR`) **before** delegating to the previous handler, so the
  record is on disk before RN reports the fatal natively and expo-updates
  aborts.
- `features/services/calls/callTrace.ts:233` installs a *second*
  `setGlobalHandler`. It is not a conflict: both capture `getGlobalHandler()`
  first and call it, so whichever installs second wraps the first and neither
  drops the error.
- Every hook in `RootLayout` (`_layout.tsx:215-565`) is unconditional and sits
  above the `if (showAnimatedSplash)` early return, so no hook-order fatal is
  possible there.
- Module scope in `_layout.tsx` follows `try { … } catch { console.warn }`
  throughout. The three bare calls — `checkAndClearCacheOnOTAUpdate()`,
  `enforceListPolicy()`, `SplashScreen.preventAutoHideAsync()` — are each
  internally guarded.

So the error was always being caught and written to MMKV. It then reached
`reportToSentry()`, which returned at `if (!Sentry?.captureMessage)`. Nothing
was broken about the capture; the pipe at the end of it had been cut.

## Still open

The specific JS fatal is **not identified**. Nothing in the crash reports, the
five Sentry issues from 1.0.343 (the last build with a reporter), or the source
names it. The next build makes it nameable; it does not fix it.

Adjacent and confirmed, from the 1.0.343 Sentry window — all main-thread stalls,
one of them a watchdog kill, none yet fixed:

- `DVNT-MOBILE-5` **fatal** app hang, `VideoAsset.init` → `AVURLAsset
  initWithURL:options:` → synchronous XPC to mediaserverd, on thread 0 under
  `swift::runJobInEstablishedExecutorContext`. expo-video's async replace path
  inherits the main actor.
- `DVNT-MOBILE-6` 4.8–5.6s hang, `VideoPlayerItem.init`.
- `DVNT-MOBILE-3` 3.2–4.0s hang, `main`.
- `DVNT-MOBILE-4` invalid hook call in the story editor — **already fixed**, in
  `a01b978` (2026-09-07). `EditorCanvas.tsx` used to call `useVideo` inside a
  ternary, so hook index 6 was a `useMemo` on image renders and
  `useVideoLoading`'s `useState` on video renders; swapping an image for a clip
  re-rendered the same fiber and threw "Should have a queue". The call is
  unconditional now, with the condition pushed into the argument
  (`source: string | null` is `useVideo`'s documented contract). The Sentry
  event is from 1.0.343, which predates the fix. `rules-of-hooks` across
  `features/stories-editor/` is clean.

`components/media-preview-modal.tsx` built a player on every render including
image previews and `media === null`; isolated into a child (295947f).

`components/feed/feed-post.tsx:358` still constructs an expo-video player for
every post including text and image ones — the bug `post/[id].tsx:396`
documents and avoids. **Not fixed.** A draft extraction exists at
`scratchpad/feed-post.halfdone.tsx`: the child component is written and covers
the surface, seek bar and fullscreen modal, but the parent's hooks were never
removed, so both were live — worse than the original bug. Finishing a
1618-line render-tree refactor of the main feed with no device to check it
against is not a trade worth making blind. Do it with a simulator open.
