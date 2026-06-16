internal import Expo
internal import EXUpdates
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {

    // ── DVNT Uncaught NSException Diagnostic Handler ─────────────────────
    // Installed by plugins/with-uncaught-exception-handler.js
    // __DVNT_UNCAUGHT_EXCEPTION_HANDLER_INSTALLED__
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

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
