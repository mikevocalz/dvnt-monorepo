/**
 * Sneaky Lynk — room-aware observability seam.
 *
 * A live room is the one place in this app where Sentry's default instincts
 * are actively harmful: the main thread is committed to media, and the two
 * things that interrupt it — the app-hang watchdog and the profiler — fire
 * hardest exactly when the room is busiest.
 *
 * Both platform legs call `enterRoomObservability()` on join and
 * `exitRoomObservability()` on leave. Nothing here may be called from a render
 * path: these mutate SDK state and belong in join/leave effects only.
 *
 * Verified against @sentry/react-native 8.22.0:
 *   - pauseAppHangTracking / resumeAppHangTracking — dist/js/sdk.d.ts:127,135
 *   - getClient().getOptions() returns the live options object by reference
 *     (@sentry/core client.js:216-218), and the profiling integration re-reads
 *     `profilesSampleRate` off it at every span start
 *     (dist/js/profiling/integration.js:97-107) — so setting it to 0 here
 *     suppresses profiling for the room and restoring it re-arms profiling
 *     without a re-init.
 *
 * Interaction tracing needs no clause: `enableUserInteractionTracing` is off
 * globally (audit 2.6). Replay needs none either — it is removed (2.3).
 *
 * Web is a no-op: `sentry-boot.ts` (the web fork) exports `Sentry` as
 * undefined, and the Next app runs its own instrumentation.
 */

interface RoomSentryRuntime {
  pauseAppHangTracking?: () => void;
  resumeAppHangTracking?: () => void;
  getClient?: () => { getOptions?: () => { profilesSampleRate?: number } | undefined } | undefined;
}

/** Resolved lazily through the platform fork, matching lib/native-exception-log.ts. */
function roomSentry(): RoomSentryRuntime | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@dvnt/app/lib/sentry-boot");
    return (mod?.Sentry as RoomSentryRuntime | undefined) ?? null;
  } catch {
    return null;
  }
}

/** ponytail: a boolean, not a depth counter — a user is in at most one room at
 *  a time, so the only re-entrancy is a duplicate enter from a re-mounted
 *  effect, and idempotence covers that. Revisit if rooms ever nest. */
let _inRoom = false;
/** The rate to put back on exit — restore prior state, never a hardcoded default. */
let _priorProfilesSampleRate: number | undefined;
let _profilesSuppressed = false;

export function enterRoomObservability(): void {
  if (_inRoom) return;
  _inRoom = true;

  const sentry = roomSentry();
  if (!sentry) return;

  try {
    sentry.pauseAppHangTracking?.();
  } catch {
    /* observability must never take the room down */
  }

  try {
    const options = sentry.getClient?.()?.getOptions?.();
    if (options && typeof options.profilesSampleRate === "number") {
      _priorProfilesSampleRate = options.profilesSampleRate;
      options.profilesSampleRate = 0;
      _profilesSuppressed = true;
    }
  } catch {
    /* ditto */
  }
}

export function exitRoomObservability(): void {
  if (!_inRoom) return;
  _inRoom = false;

  const sentry = roomSentry();
  if (!sentry) return;

  try {
    // ponytail: this seam is the only caller of pause/resume in the repo, so
    // resuming here cannot clobber a pause someone else owns. If a second
    // caller ever appears, both need a shared owner rather than a second flag.
    sentry.resumeAppHangTracking?.();
  } catch {
    /* never throw out of a leave path */
  }

  if (_profilesSuppressed) {
    try {
      const options = sentry.getClient?.()?.getOptions?.();
      if (options) options.profilesSampleRate = _priorProfilesSampleRate;
    } catch {
      /* ditto */
    }
    _profilesSuppressed = false;
    _priorProfilesSampleRate = undefined;
  }
}
