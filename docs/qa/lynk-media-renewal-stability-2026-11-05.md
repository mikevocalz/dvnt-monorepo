# Sneaky Lynk web media renewal stability

## Scope and confirmed defect

Investigated video and audio repeatedly dropping in a multi-person web Lynk. This patch is based on production source commit `b722385` and changes web media transport wiring only. The speaking rings in the supplied screenshot are voice activity, and the circular corner controls rotate video. Neither is evidence of a network outage by itself.

The source contains a concrete periodic disconnect path:

1. `apps/mobile/supabase/functions/_shared/lynk-moq-access.ts` issues grants valid for at most 120 seconds, with room-deadline and repeated admission checks.
2. `packages/app/lib/lynk/moq-token-session.ts` renews 60 seconds before expiry.
3. Both `useLynkBroadcast.web.ts` and `useLynkViewer.web.ts` previously wrote every refreshed credential URL straight into `Connection.url`.
4. The released `@moq/net@0.4.3` Connection/Reload explicitly closes the current transport when the URL changes, then dials a replacement. The private connection's origin survives, but its session announcements retract.
5. Viewer discovery removes absent publishers and closes their Player, including audio and video decoders. Reappearance needs new subscriptions and a decoded frame, causing audio interruption and visible avatar fallback.

The new actual-SDK test reproduces this behavior without live accounts or network calls. This proves a client-forced disconnect defect; it does not establish that every interruption in the reported call had this cause. HTTP 200 token gateway records alone cannot distinguish successful grants from business refusals encoded in response bodies.

## Fix

- Continue every existing short-lived grant refresh and server admission check. No longer change a healthy connection's URL for an equivalent refreshed grant.
- Retain the newest authorized URL for the next actual disconnect or terminal SDK error. Observe SDK signals directly, not a possibly stale React connection-state snapshot.
- Compare room/account/intent epochs, relay host/port/path/options, application, namespace, path, peer identity and role. Only the rotating `jwt` parameter is omitted from relay identity.
- Null, denied, malformed and expired grants clear media authority. Same-URL credentials presented under changed authority fail closed until a distinct credential arrives. Delayed background timers cannot make a reconnect use an already expired grant.
- Keep retries idempotent, preserve SDK backoff, and unsubscribe before cleanup. No token lifetime enlargement, camera/mic privacy changes, capture-blackout relaxation, host-mute changes or native transport changes.

This is continuity under fresh equivalent authorization, not in-place relay JWT rotation. The provider may independently terminate a wire at its original JWT expiry; that behavior remains unverified. Such a termination installs the newest grant and reconnects, but is not promised to be inaudible.

## Local verification

All final checks below passed against this patch:

- Complete Node suite: **1,853/1,853**, no skips. An initial run lacked isolated fixture dependencies; after supplying those dependencies, the complete rerun passed.
- Lynk CI-equivalent unit/handler/admission fixture suite: **480/480**, no skips.
- Separate SQL/atomic-admission/legacy-token handler suite: **20/20**, no skips.
- New authorization/session suite: **19/19**, including 10-minute renewal retention, scope/endpoint/owner changes, same-URL fail-closed, real-drop newest credentials, delayed expiry, terminal business denial, hard expiry after renewal failure, leave and listener disposal.
- Actual `@moq/net@0.4.3` Connection/Reload/signals regression: baseline URL renewal closes/redials; twelve one-minute renewals with current valid grants retain one healthy wire; real SDK Unauthorized handling redials once using the newest grant; null authority closes the wire; expiry cannot restart a connection. Only the low-level `connect()` transport is replaced.
- Production publisher hook with released capture SDK and signals: eleven renewals retain transport URL, camera/mic tracks, encoder/publication resources and receiving viewer. Existing capture failure/retry, background/resume, host mute, role loss and cleanup tests pass.
- Production receiver hook with released signals: eleven renewals retain the decoder/audio Player and usable video without avatar fallback. Existing camera suspension, frame recovery, ref churn, jitter, removal/rejoin and leave checks pass; terminal denial clears the relay URL.
- Real asynchronous signal harness: **2/2**.
- Actual React room, web capture controls, native capture/session, gallery canvas/audio lifecycle and capture-boundary DOM fixtures pass. No UI geometry or privacy policy change.
- Strict focused TypeScript check for the new controller, React hook and tests against actual SDK/React declarations; changed production TypeScript transpilation.
- Focused hooks ESLint: no errors; one pre-existing unused `exhaustive-deps` disable warning in the broadcaster.
- `verify-lynk`, web route audit (145 routes / 263 files), release-regression manifest audit and `git diff --check`.
- Independent source review and independent rerun of the new unit and actual-SDK regression: no remaining blocker.

The admission fixture's Connection adapter now exposes the real SDK's error signal. Existing lightweight token adapters now carry expiry metadata. These changes preserve their assertions rather than bypassing the new checks.

The CI workflow includes the new regression and pins its actual networking SDK version. CI has not run for this patch because it has not been pushed.

## Verification limits and release boundary

No full workspace typecheck, production web build, real browser/relay transport acceptance, physical-device call, or audible multiuser session is claimed. DOM/SDK transport-boundary fixtures are not an end-to-end provider test.

No push, draft PR, merge, deployment, live migration, credentials change, live room, or customer communication was performed. Publication is held because Vercel preview-build suppression was not verified and the user's build pause must be respected. Production is unchanged.

Before release, after explicit release authorization and a safe build path:

1. Publish the source to a draft PR and run its complete CI/typecheck/build gates.
2. Use an authorized controlled room in Mac Chrome and iPhone Safari for at least 15 minutes. Count actual transport sessions separately from successful/denied authorization responses and verify continuous bidirectional audio/video across renewals.
3. Cover network interruption/recovery, background/foreground, camera and mic off, host mute, permission refusal, account/room change, kick/room end and tab close. Confirm camera/mic and decoders stop at privacy boundaries.
4. Determine whether Fishjam enforces the original wire's JWT expiry. If it does, a provider-supported seamless handover is a separate release blocker for a claim of uninterrupted renewal.
5. Native iOS/Android transport acceptance is separate; this patch does not change the native reconnection path.
