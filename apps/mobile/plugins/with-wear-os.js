/**
 * Wear OS config plugin.
 *
 * There is no `@bacons/apple-targets` equivalent on Android. On iOS that plugin
 * generates real Xcode targets from a folder; on Android, CNG deletes `android/`
 * and regenerates it from the template on every `expo prebuild`. So a wear
 * module added by hand under `android/wear/` disappears the next time anyone
 * prebuilds, and it disappears silently — the app still builds, it just quietly
 * ships without a watch app.
 *
 * The source of truth therefore lives at `apps/mobile/wear/`, OUTSIDE android/,
 * and this plugin re-applies it every run:
 *
 *   1. copy `apps/mobile/wear/` -> `android/wear/`
 *   2. append `include ':wear'` to settings.gradle          (idempotent)
 *   3. add play-services-wearable to the PHONE app deps     (idempotent)
 *   4. drop the phone-side sender + capability declaration into the app module
 *
 * Every step must be idempotent. Two prebuilds in a row that produce two
 * `include ':wear'` lines is the single most common way this pattern breaks,
 * and Gradle's error for it does not mention the plugin.
 *
 * Modelled on ./with-live-activity-android.js — same withDangerousMod shape.
 */

const {
  withDangerousMod,
  withAppBuildGradle,
  withMainApplication,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const WEAR_INCLUDE = "include ':wear'";
const WEARABLE_DEP = "com.google.android.gms:play-services-wearable:20.0.1";

/** Recursive copy. `fs.cpSync` needs Node 16.7+; the repo is well past that. */
function copyTree(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function withWearModuleSources(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const androidDir = config.modRequest.platformProjectRoot;
      const source = path.join(config.modRequest.projectRoot, "wear");
      const dest = path.join(androidDir, "wear");

      if (!fs.existsSync(source)) {
        console.warn(`[with-wear-os] No wear sources at ${source} — skipping.`);
        return config;
      }

      // Replace outright rather than merging: a stale .kt left behind from a
      // rename would still compile into the APK and shadow the real one.
      fs.rmSync(dest, { recursive: true, force: true });
      copyTree(source, dest);

      // --- settings.gradle: include the module exactly once ----------------
      const settingsPath = ["settings.gradle", "settings.gradle.kts"]
        .map((f) => path.join(androidDir, f))
        .find((p) => fs.existsSync(p));

      if (!settingsPath) {
        console.warn("[with-wear-os] No settings.gradle found — ':wear' not included.");
        return config;
      }

      const settings = fs.readFileSync(settingsPath, "utf8");
      // Match ':wear' in either quoting style, so a .kts project or a
      // hand-edited file does not get a duplicate appended.
      if (/include\s*\(?\s*['"]:wear['"]/.test(settings)) {
        console.log("[with-wear-os] ':wear' already included — left alone.");
      } else {
        const line = settingsPath.endsWith(".kts") ? `include(":wear")` : WEAR_INCLUDE;
        fs.writeFileSync(settingsPath, `${settings.trimEnd()}\n${line}\n`);
        console.log(`[with-wear-os] Added ${line} to ${path.basename(settingsPath)}`);
      }

      // --- phone side: capability declaration ------------------------------
      // Lets the WATCH ask CapabilityClient "is the phone app installed?" and
      // get a real answer rather than inferring it from a timeout.
      const phoneValues = path.join(androidDir, "app", "src", "main", "res", "values");
      fs.mkdirSync(phoneValues, { recursive: true });
      fs.writeFileSync(
        path.join(phoneValues, "wear.xml"),
        `<resources>\n    <string-array name="android_wear_capabilities">\n        <item>dvnt_phone_app</item>\n    </string-array>\n</resources>\n`
      );

      // --- phone side: the sender + its listener service -------------------
      const phoneJava = path.join(androidDir, "app", "src", "main", "java", "com", "dvnt", "app");
      fs.mkdirSync(phoneJava, { recursive: true });
      const pluginDir = path.join(__dirname, "wear-os-phone");
      if (fs.existsSync(pluginDir)) {
        for (const f of fs.readdirSync(pluginDir)) {
          fs.copyFileSync(path.join(pluginDir, f), path.join(phoneJava, f));
        }
        console.log("[with-wear-os] Wrote phone-side Data Layer sources");
      }

      return config;
    },
  ]);
}

/**
 * The phone app needs the Data Layer client too — it is the side that PUTS the
 * DataItem. Appended to the existing dependencies block rather than a new one,
 * and guarded so repeated prebuilds do not stack duplicate lines.
 */
function withWearableDependency(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      console.warn("[with-wear-os] app/build.gradle is not Groovy — dependency not added.");
      return config;
    }
    if (config.modResults.contents.includes("play-services-wearable")) {
      return config;
    }
    config.modResults.contents = config.modResults.contents.replace(
      /^dependencies\s*\{/m,
      `dependencies {\n    // Data Layer — the phone is the side that writes /tickets.\n    implementation "${WEARABLE_DEP}"`
    );
    return config;
  });
}

/**
 * Register the ReactPackage with MainApplication.
 *
 * This step is the whole difference between a native module that works and one
 * that is `undefined` in JS. Copying a ReactPackage.kt into
 * android/app/src/main/java/ compiles fine, ships fine, and does nothing —
 * `PackageList(this).packages` only contains autolinked modules, and a
 * hand-added package must be appended to that list explicitly.
 *
 * There is a live example of the failure in this repo:
 * plugins/with-live-activity-android.js copies DVNTLiveNotificationPackage.kt
 * into the app module but never registers it, so NativeModules.
 * DVNTLiveNotification is undefined at runtime. Not fixed here — enabling a
 * module that has been dormant is a behaviour change, not a wiring fix — but
 * that is why this function exists.
 */
function withWearPackageRegistered(config) {
  return withMainApplication(config, (config) => {
    const src = config.modResults.contents;

    if (src.includes("WearBridgePackage()")) {
      return config;
    }

    // The Expo template emits `PackageList(this).packages.apply {` with a
    // commented example inside. Append into that block.
    const anchor = /(PackageList\(this\)\.packages\.apply\s*\{)/;
    if (!anchor.test(src)) {
      console.warn(
        "[with-wear-os] Could not find PackageList(...).packages.apply in MainApplication — " +
          "WearBridgePackage NOT registered. The JS module will be undefined."
      );
      return config;
    }

    config.modResults.contents = src.replace(
      anchor,
      "$1\n          // Data Layer bridge for the Wear OS app (plugins/with-wear-os.js).\n          add(WearBridgePackage())"
    );
    return config;
  });
}

module.exports = function withWearOS(config) {
  return withWearPackageRegistered(withWearableDependency(withWearModuleSources(config)));
};
