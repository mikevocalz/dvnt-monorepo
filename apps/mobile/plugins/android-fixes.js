/**
 * Expo Config Plugin: Android Build Fixes
 *
 * Automatically applies on every `expo prebuild`:
 * 1. Adds Regula Face SDK Maven repository
 * 2. Adds tools:replace="android:allowBackup" to fix manifest merger conflict
 * 3. Patches CallKeep VoiceConnectionService foregroundServiceType for Android 11+
 */

const {
  withProjectBuildGradle,
  withSettingsGradle,
  withAndroidManifest,
} = require("expo/config-plugins");

const MAVEN_CENTRAL_MIRROR =
  "maven { url 'https://maven-central.storage-download.googleapis.com/maven2/' }";

function insertBefore(contents, needle, insertion) {
  if (contents.includes(insertion) || !contents.includes(needle)) {
    return contents;
  }

  return contents.replace(needle, `${insertion}\n${needle}`);
}

function insertAfter(contents, needle, insertion) {
  if (contents.includes(insertion) || !contents.includes(needle)) {
    return contents;
  }

  return contents.replace(needle, `${needle}\n${insertion}`);
}

/** Add Maven Central mirror to generated settings.gradle pluginManagement.repositories */
function withGradleMirrorSettings(config) {
  return withSettingsGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes("maven-central.storage-download.googleapis.com")) {
      return config;
    }

    config.modResults.contents = insertAfter(
      contents,
      "pluginManagement {",
      "  repositories {\n    maven { url = uri(\"https://maven-central.storage-download.googleapis.com/maven2/\") }\n    google()\n    gradlePluginPortal()\n    mavenCentral()\n  }",
    );

    return config;
  });
}

/** Add Regula Maven repo to allprojects.repositories in build.gradle */
function withRegulaMaven(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    contents = insertBefore(contents, "    mavenCentral()", `    ${MAVEN_CENTRAL_MIRROR}`);

    if (!contents.includes("maven.regulaforensics.com")) {
      contents = contents.replace(
        "maven { url 'https://www.jitpack.io' }",
        "maven { url 'https://www.jitpack.io' }\n    maven { url 'https://maven.regulaforensics.com/RegulaDocumentReader' }",
      );
    }

    config.modResults.contents = contents;

    return config;
  });
}

/** Add tools:replace="android:allowBackup" to <application> */
function withAllowBackupFix(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];

    if (mainApplication) {
      // Ensure tools namespace is declared
      if (!config.modResults.manifest.$["xmlns:tools"]) {
        config.modResults.manifest.$["xmlns:tools"] =
          "http://schemas.android.com/tools";
      }

      // Add tools:replace for allowBackup
      if (!mainApplication.$["tools:replace"]) {
        mainApplication.$["tools:replace"] = "android:allowBackup";
      } else if (
        !mainApplication.$["tools:replace"].includes("android:allowBackup")
      ) {
        mainApplication.$["tools:replace"] += ",android:allowBackup";
      }
    }

    return config;
  });
}

/**
 * Patch CallKeep's VoiceConnectionService to use the correct foregroundServiceType.
 * The @config-plugins/react-native-callkeep plugin sets "phoneCall" only, but
 * Android 11+ (API 30) requires "phoneCall|microphone|camera" for video calls
 * that use foreground services with camera/mic access.
 */
function withCallKeepServiceType(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];

    if (mainApplication && Array.isArray(mainApplication.service)) {
      for (const service of mainApplication.service) {
        if (
          service.$["android:name"] ===
          "io.wazo.callkeep.VoiceConnectionService"
        ) {
          // Upgrade foregroundServiceType to include microphone + camera
          service.$["android:foregroundServiceType"] =
            "phoneCall|microphone|camera";
        }
      }
    }

    return config;
  });
}

/** Combined plugin */
function withAndroidFixes(config) {
  config = withGradleMirrorSettings(config);
  config = withRegulaMaven(config);
  config = withAllowBackupFix(config);
  config = withCallKeepServiceType(config);
  return config;
}

module.exports = withAndroidFixes;
