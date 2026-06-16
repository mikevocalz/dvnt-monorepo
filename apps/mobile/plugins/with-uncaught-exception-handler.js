/**
 * Expo Config Plugin: NSSetUncaughtExceptionHandler in AppDelegate.swift
 *
 * Captures uncaught Objective-C exceptions thrown from any thread,
 * including TurboModule async invocations that land on libdispatch
 * worker threads.
 *
 * The 1.0.247 TestFlight crash log showed the following stack pattern
 * with no symbolicated method name:
 *
 *   Thread 18 Crashed:
 *     abort
 *     objc_terminate
 *     __cxa_rethrow
 *     objc_exception_rethrow
 *     performVoidMethodInvocation     ← RCTTurboModule.mm:467
 *     dispatch worker
 *
 * The dispatch_async block in performVoidMethodInvocation rethrows on
 * NSException without recording WHICH NSInvocation threw — so the .ips
 * file gives us the wrapper but not the actual throwing module/method.
 * This handler records the exception's name, reason, userInfo, and
 * full call stack symbols BEFORE objc_terminate calls abort(), then
 * persists the report to disk so the next launch can surface it.
 *
 * What gets captured per crash:
 *   - timestamp (ISO 8601)
 *   - NSException.name
 *   - NSException.reason
 *   - NSException.userInfo (description)
 *   - callStackSymbols (the actual symbolicated stack — this is the
 *     piece missing from the .ips for app-side frames)
 *   - thread name
 *
 * Where it lands:
 *   - NSLog (visible in Xcode console + Console.app + TestFlight
 *     attached devicelogs)
 *   - JSON file at <Documents>/dvnt-uncaught-exception.json — read
 *     by lib/native-exception-log.ts on JS startup so the next session
 *     can ship the report to Sentry / log it to console.
 *
 * Recovery semantics: this handler does NOT swallow the exception.
 * After logging, control returns to the previous handler chain (or
 * the default, which is objc_terminate → abort). We do not pretend
 * the app is still safe to run when an unhandled NSException has
 * unwound an arbitrary call stack — recovery would create undefined
 * behavior. The fix here is diagnostic, not fault-tolerant.
 *
 * NOTE: NSSetUncaughtExceptionHandler ONLY catches exceptions on
 * threads with the standard runtime — it does not fire for C++
 * exceptions or for Swift errors that aren't bridged to ObjC. The
 * crash we're targeting IS an ObjC NSException (objc_exception_rethrow
 * in the stack), so this handler will catch it.
 */

const { withDangerousMod } = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

const MARKER = "// __DVNT_UNCAUGHT_EXCEPTION_HANDLER_INSTALLED__";

const HANDLER_BLOCK = `
    // ── DVNT Uncaught NSException Diagnostic Handler ─────────────────────
    // Installed by plugins/with-uncaught-exception-handler.js
    ${MARKER}
    NSSetUncaughtExceptionHandler { exception in
      let isoFormatter = ISO8601DateFormatter()
      isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let timestamp = isoFormatter.string(from: Date())

      let name = exception.name.rawValue
      let reason = exception.reason ?? "(no reason)"
      let userInfoDesc = exception.userInfo?.description ?? "(no userInfo)"
      let stackSymbols = exception.callStackSymbols
      let threadName = Thread.current.name ?? "(unnamed)"
      let isMain = Thread.isMainThread

      // 1. NSLog — surfaces in Xcode console, Console.app, and TestFlight
      //    devicelogs. Bracketed banner makes it greppable.
      NSLog("╔═══════════════════════════════════════════════════════╗")
      NSLog("║  [DVNT-CRASH] UNCAUGHT NSException                    ║")
      NSLog("╚═══════════════════════════════════════════════════════╝")
      NSLog("[DVNT-CRASH] timestamp:     %@", timestamp)
      NSLog("[DVNT-CRASH] thread:        %@ (main=%@)", threadName, isMain ? "YES" : "NO")
      NSLog("[DVNT-CRASH] exception.name:   %@", name)
      NSLog("[DVNT-CRASH] exception.reason: %@", reason)
      NSLog("[DVNT-CRASH] userInfo:       %@", userInfoDesc)
      NSLog("[DVNT-CRASH] ── call stack ──")
      for (idx, frame) in stackSymbols.enumerated() {
        NSLog("[DVNT-CRASH]  %02d  %@", idx, frame)
      }
      NSLog("[DVNT-CRASH] ════════════════════════════════════════════════")

      // 2. Persist to JSON for the JS side to surface on next launch.
      //    Best-effort — if disk write fails we still got the NSLog.
      let payload: [String: Any] = [
        "timestamp": timestamp,
        "thread": threadName,
        "isMainThread": isMain,
        "name": name,
        "reason": reason,
        "userInfo": userInfoDesc,
        "callStackSymbols": stackSymbols,
      ]
      if let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
        let url = docs.appendingPathComponent("dvnt-uncaught-exception.json")
        if let data = try? JSONSerialization.data(
          withJSONObject: payload,
          options: [.prettyPrinted]
        ) {
          try? data.write(to: url, options: .atomic)
        }
      }

      // Do NOT swallow — let the previous handler (or default abort)
      // continue. The runtime is unwound; recovery is undefined.
    }

`;

function withUncaughtExceptionHandler(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const appName = config.modRequest.projectName || "DVNT";
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        appName,
        "AppDelegate.swift",
      );

      if (!fs.existsSync(appDelegatePath)) {
        console.warn(
          "[withUncaughtExceptionHandler] AppDelegate.swift not found, skipping",
        );
        return config;
      }

      let content = fs.readFileSync(appDelegatePath, "utf8");

      // Idempotent — don't double-inject if the plugin runs twice.
      if (content.includes(MARKER)) {
        return config;
      }

      // Inject AT THE TOP of didFinishLaunchingWithOptions so the
      // handler is installed BEFORE any other code (RN bootstrap,
      // TurboModule registration, native module init) can throw.
      // We pattern-match the function signature; the AppController
      // init plugin runs first and adds its own block right after
      // the function header, so we splice in BEFORE that.
      const before = content;
      content = content.replace(
        /(didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\? = nil\s*\) -> Bool \{\s*\n)/,
        `$1${HANDLER_BLOCK}`,
      );

      if (content === before) {
        // Couldn't find the signature — skip with a clear warning so
        // a future expo bump that changes the signature doesn't
        // silently drop the diagnostic.
        console.warn(
          "[withUncaughtExceptionHandler] could not splice into didFinishLaunchingWithOptions; AppDelegate.swift signature changed?",
        );
        return config;
      }

      fs.writeFileSync(appDelegatePath, content);
      return config;
    },
  ]);
}

module.exports = withUncaughtExceptionHandler;
