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
where event = 'app_issue' and feature_area = 'crash'
order by created_at desc
limit 20;
```

That is the shape `reportIssue` actually inserts (`lib/analytics/report-issue.ts`
— `event` is the constant `'app_issue'` and the caller's bucket lands in
`feature_area`). An earlier draft of this runbook said
`where event = 'prior_session_crash'`, which matches no row.

`metadata.kind` is `js`, `native`, or `expo-updates-recovery`.
`metadata.reason` is the thing to read first. For `kind = 'native'`,
`metadata.detail.thread` and `detail.isMainThread` say which thread threw,
which is how to tell a background-task session from a foreground one.

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

## The reader was broken too — audited 2026-09-13

The transport was not the only cut pipe. The **native** leg of the capture table
above never ran either, on any build, for a reason nothing in the source
comments predicted.

`lib/native-exception-log.ts` resolved the report file as
`require("expo-file-system").documentDirectory`. In expo-file-system **57**
(installed here; `node_modules/expo-file-system/package.json`) the package root
no longer exports that. `src/index.ts` re-exports `Paths`, `File`, `Directory`,
the network tasks, the types, and `legacyWarnings` — and `documentDirectory` is
not among them. `getInfoAsync`, `readAsStringAsync` and `deleteAsync` do still
resolve, but only as the stubs in `src/legacyWarnings.ts:18-40`, which
`console.warn` and then `throw`.

So `docs` was `undefined` and the function returned at
`if (!docs) return null` on every boot. `dvnt-uncaught-exception.json` was
written by the `NSSetUncaughtExceptionHandler` block in `AppDelegate.swift` on
every one of these crashes, read by nobody, and — because the old code never
reached its own `deleteAsync` — never deleted.

That file is the best copy of the original error there is.
`ErrorRecovery.crash()` builds the NSException it re-raises out of the initial
error: `name` becomes `"RCTFatalException: <localizedDescription>"` and `reason`
becomes `RCTFormatError(localizedDescription, userInfo[RCTJSStackTraceKey], 175)`
(`ErrorRecovery.swift:258-267`), with the untruncated copy under
`RCTUntruncatedMessageKey`. The AppDelegate handler persists `name`, `reason`,
`userInfo` and `callStackSymbols` before `abort`. The JS message and the JS
stack are in there.

Fixed by reading through `new File(Paths.document, …)` with
`expo-file-system/legacy` as the fallback for a pre-SDK-54 binary. Pure JS over
the native module already in the binary, so it ships over OTA. A missing
filesystem API now `console.warn`s instead of returning `null` quietly.

Because the delete never ran, the payload from the most recent crash should
still be on the two affected devices. The first launch on a bundle carrying this
fix ships it to `analytics_events` and to Sentry via
`lib/analytics/sentry-envelope.ts`.

## What the launch actually was

Read off the Sentry copies of the same crash (`DVNT-MOBILE-2`, 14 events, 2
users, 1.0.343). Three events sampled across both devices and three days —
`0951774b` iPhone18,1 09-07, `435cde2e` iPhone18,1 09-05, `260c69d8` iPad8,7
09-05 — agree on all of this:

- `app.is_active` is **false** in every one. The process never became active.
- `app_start_time` to abort is **1-3 seconds**: 01:47:39→01:47:40,
  20:15:58→20:15:59, 04:56:25→04:56:28.
- The event timestamps cluster in ~30-minute pairs, several of them to the
  second: 14:02:46 and 14:32:46; 01:17:01 and 01:47:40; 11:20:57, 11:51:40,
  12:21:51. That is a scheduler, not a person opening an app.

`lib/background-tasks/index.ts:57` registers four TaskManager jobs at
`minimumInterval: 15` minutes, multiplexed under the one permitted identifier
`com.expo.modules.backgroundtask.processing`
(`ios/DVNT/Info.plist`). `UIBackgroundModes` is
`voip, fetch, remote-notification, processing, audio`, so the OS has five ways
to start this process without a user.

That matters for the abort, not just for triage. `handleContentDidAppear`
(`ErrorRecovery.swift:306-323`) is the only thing that ever calls
`unsetRCTErrorHandlers`, and it fires off `RCTContentDidAppear`. A launch where
no root view renders never fires it, so the fatal handlers stay armed for the
whole life of that process. A JS error that a foreground session would have
shown as a red box or swallowed becomes `RCTFatal` → `startPipeline` → SIGABRT.

**Not yet proven:** that the crashing sessions are specifically the BGTask ones
rather than some other non-active launch. `is_active: false` and a 30-minute
cadence are consistent with it and with nothing else obvious, but no log ties an
abort to a task run. The `analytics_events` row from the reader fix will say —
the persisted `thread` field distinguishes a background worker from the main
thread.

## Disproven: no expo-updates setting avoids this

Checked against the installed `expo-updates@57.0.12` source, not the docs.

`apps/mobile/ios/DVNT/Supporting/Expo.plist` is what actually configures the
native side (`app.config.js`'s `updates` block is only its input; `Info.plist`
carries none of it):

```
EXUpdatesEnabled = true
EXUpdatesCheckOnLaunch = ALWAYS
EXUpdatesLaunchWaitMs = 0
EXUpdatesRuntimeVersion = file:fingerprint
EXUpdatesURL = https://u.expo.dev/5c0d13a3-…
```

The pipeline is built once, in the initializer, and tasks are only ever removed
from it (`ErrorRecovery.swift:109-115`). `.crash` is the last element and
nothing removes it. So:

- `checkOnLaunch: ALWAYS` (from `checkAutomatically: "ON_LOAD"`) sends
  `waitForRemoteLoaderToFinish` down the `isWaitingForRemoteUpdate = true`
  branch at `:199-214`. The load is already in flight from launch, so `notify`
  lands within a second and `runNextTask` reaches `.crash`. That is the observed
  stack and the observed 1s.
- `ERROR_RECOVERY_ONLY` and `WIFI_ONLY` take the same branch — `:199` only
  tests `!= .Never`.
- `NEVER` takes the `else` at `:215-219`, which removes `.launchNew` and calls
  `runNextTask()` **immediately**. Same abort, sooner.
- `launchWaitMs` and the runtime-version policy are not read anywhere in
  `ErrorRecovery`.

The only setting that removes the abort is `EXUpdatesEnabled = false`, which
turns off OTA. There is no configuration fix here. Whatever throws has to stop
throwing.

## Unrelated bug found in the same sweep

`plugins/with-app-controller-init.js` has never inserted
`AppController.initializeWithoutStarting()` into the committed
`AppDelegate.swift`. Its anchor required `let delegate` to follow `) -> Bool {`
directly, which only holds on a clean prebuild; on an incremental one
`with-uncaught-exception-handler`'s block sits between them. The regex missed,
`modified` was set from `!content.includes(...)` rather than from the replace,
and the plugin wrote the file back unchanged and reported success. The committed
file shows both halves of that: it has the `internal import EXUpdates` the
plugin adds, and no init call.

Re-anchored on `let delegate = ReactNativeDelegate()`, which is the last
statement before `factory.startReactNative(...)`, and a failed insertion now
warns. `initializeWithoutStarting()` is idempotent
(`AppController.swift:212-215` returns early when `_sharedInstance != nil`), so
this cannot double-initialize.

**This is not the SIGABRT.** The abort runs through `ErrorRecovery`, which
requires a started `AppController`, so the missing call is demonstrably not
blocking anything at launch. It also needs a native rebuild to take effect.

## Still open

The specific JS fatal is **not identified**. Neither sink has a record of it:
`analytics_events` holds zero `app_issue` rows, and the five Sentry issues from
1.0.343 do not include a fatal JS event. The one JS error there,
`DVNT-MOBILE-4`, is tagged `handled: yes, level: error, mechanism: generic` —
caught, 74s into an active session — so it is not the initial error either.

What changed is that the record now gets read. The reader fix does not stop the
crash; it is the last blocker between the crash and its reason string.

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

### expo-video call sites, swept

Every `useVideoPlayer` in the app, and what it is now:

| Site | State |
|---|---|
| `components/feed/feed-post.tsx` | **Fixed** (9832b50) — player moved into `<FeedPostVideo/>`, mounts only for video posts. Was one AVPlayer per row. |
| `components/media-preview-modal.tsx` | **Fixed** (295947f) — was building one for image previews and `media === null`. |
| `features/routes/screens/(protected)/story/[id].tsx` | **Fixed** — the non-video fallback was `""`; now `null`, the only source the native side provably routes to `clearCurrentItem`. |
| `features/routes/screens/(protected)/post/[id].tsx` | Already correct — `PostVideoPlayer`, the pattern the others copy. |
| `features/routes/screens/(protected)/story/create.tsx` | Correct — `StoryVideoPreview({ uri: string })` is already isolated. |
| `features/events/ui/WhoAllOverThere.tsx` (`ViewerVideo`) | Correct — isolated child, `uri` required. |
| `components/media/DVNTAnimatedVideoView.tsx` | Correct — `uri: string` required, the component is the player. |
| `features/routes/screens/(auth)/login.tsx`, `features/camera/CameraScreen.tsx`, `features/screens/landing/sections/Hero.native.tsx` | Left alone — local bundled assets and local recording URIs. No network XPC, so not the hang. |
| `components/media/DVNTVideoPlayer.tsx` | Not applicable — imports `react-native-video`, not expo-video. Its `mixAudioMode` is that library's correct API. |

**Left alone deliberately:** `WhoAllOverThere.tsx`'s `VideoFrameThumb` renders a
real video player per moment, as a fallback when `thumbnail_url` is null, inside
a non-virtualised `ScrollView` `.map` (`:558`). If the thumbnail backfill ever
falls behind, that is N players at once. The comment above it explains the
choice — `expo-video-thumbnails` failed silently on legacy remote videos — so
the fix is server-side thumbnail coverage, not a client swap.
