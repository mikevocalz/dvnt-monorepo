/**
 * Silence console.log/info/debug in release builds.
 *
 * This is not about noise or bundle size. On iOS every console call goes out
 * through NSLog, which takes a process-wide unfair lock inside CoreFoundation's
 * stderr writer. The 2026-09-07 20:47 watchdog kill on the iPad — 0x8BADF00D,
 * "scene-update watchdog transgression: exhausted real (wall clock) time
 * allowance of 10.00 seconds" — has the main thread parked in exactly that
 * lock:
 *
 *   __ulock_wait2 <- _os_unfair_lock_lock_slow <- _logToStderr
 *     <- __CFLogCString <- _NSLogv <- NSLog
 *     <- -[EXTaskService executeTask:withData:withError:]
 *
 * The blocking frame is Expo's own NSLog inside the background-task service,
 * before any of our JS ran, so no JS-side timeout reaches it. What we control
 * is how much other traffic is contending for that lock: 972 console.log calls
 * ship in this bundle, 385 of them in stores, components and features.
 *
 * The thorough fix is babel-plugin-transform-remove-console, which deletes the
 * call sites outright. It is NOT used here because adding it changes the React
 * Native autolinking config, which moves the EAS fingerprint off the runtime
 * every installed build is asking for — so the fix would reach nobody until a
 * new native build shipped. Doing it in JS keeps it deliverable over OTA. Fold
 * the babel plugin in with the next native build and delete this.
 *
 * warn and error stay: Sentry lifts them as breadcrumbs, and they are rare
 * enough not to be the pressure.
 */

// eslint-disable-next-line no-undef
if (typeof __DEV__ !== "undefined" && !__DEV__) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}

export {};
