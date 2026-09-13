/**
 * Expo Config Plugin: AppController.initializeWithoutStarting() before React launch
 *
 * Prevents "AppController.sharedInstance was called before the module was initialized"
 * crash. ExpoUpdatesReactDelegateHandler (and others) access AppController during
 * bundleURL() before it's initialized. Must call initializeWithoutStarting() first.
 * See: https://github.com/expo/expo/issues/32650
 */

const { withDangerousMod } = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

function withAppControllerInit(config) {
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
          "[withAppControllerInit] AppDelegate.swift not found, skipping",
        );
        return config;
      }

      let content = fs.readFileSync(appDelegatePath, "utf8");

      const initBlock = `    // CRITICAL: Initialize AppController before React starts. Otherwise ExpoUpdatesReactDelegateHandler
    // (and others) access AppController.sharedInstance during bundleURL() → assertion crash.
    // See: https://github.com/expo/expo/issues/32650
    // NOTE: Do NOT call controller.start() here — ExpoUpdatesReactDelegateHandler.createReactRootView()
    // already calls start(), and calling it twice triggers a precondition crash (SIGTRAP).
    AppController.initializeWithoutStarting()

`;

      if (
        !content.includes("import EXUpdates") &&
        !content.includes("internal import EXUpdates")
      ) {
        content = content.replace(
          /(internal import Expo\r?\n)/,
          "$1internal import EXUpdates\n",
        );
      }

      const before = content;

      // Insert the init block, if it isn't already there.
      //
      // The anchor used to be `) -> Bool {` immediately followed by
      // `let delegate`. That only holds on a clean prebuild. On an incremental
      // one, `with-uncaught-exception-handler` has already put its
      // NSSetUncaughtExceptionHandler block between those two lines, so the
      // regex stopped matching — and because `modified` was set from
      // `!content.includes(...)` rather than from the replace actually
      // changing anything, the plugin wrote the file back unchanged and
      // reported success. apps/mobile/ios/DVNT/AppDelegate.swift is the
      // result: it carries the `internal import EXUpdates` this plugin adds
      // and no `initializeWithoutStarting()` call.
      //
      // Anchor on the declaration itself instead. It is the last statement
      // before `factory.startReactNative(...)`, which is the call that reaches
      // `bundleURL()`, so inserting above it keeps the ordering the plugin
      // exists to guarantee. `initializeWithoutStarting()` is idempotent
      // (AppController.swift:212-215 returns early when
      // `_sharedInstance != nil`), so running after expo-updates has already
      // initialized itself is a no-op rather than a double-init.
      if (!content.includes("AppController.initializeWithoutStarting()")) {
        content = content.replace(
          /^([ \t]*)(let delegate = ReactNativeDelegate\(\))/m,
          `${initBlock}$1$2`,
        );
      }

      if (!content.includes("AppController.initializeWithoutStarting()")) {
        // Loud. A silent no-op here is what left the call out of the shipped
        // binary in the first place.
        console.warn(
          "[withAppControllerInit] could not find `let delegate = ReactNativeDelegate()` in " +
            `${appDelegatePath} — AppController.initializeWithoutStarting() was NOT inserted. ` +
            "Add it manually before factory.startReactNative(...) or fix this anchor.",
        );
      }

      if (content !== before) {
        fs.writeFileSync(appDelegatePath, content);
      }
      return config;
    },
  ]);
}

module.exports = withAppControllerInit;
