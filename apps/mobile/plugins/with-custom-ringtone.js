/**
 * Expo Config Plugin: Custom Call Ringtone
 *
 * Bundles a custom ringtone sound file into:
 * - iOS app bundle (for CallKit incoming call ringtone)
 * - Android res/raw (for notification channel sound)
 *
 * CallKit on iOS supports .wav, .caf, .aiff up to 30 seconds.
 * Android notification channels support .wav, .mp3, .ogg in res/raw.
 *
 * The sound file is referenced by name (without extension) in:
 * - iOS: RNCallKeep.displayIncomingCall() ringtoneSound parameter
 * - Android: NotificationChannel sound URI
 */

const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SOUND_FILE = "dvnt-ring.wav";
const SOUND_SOURCE = path.join("assets", "audio", SOUND_FILE);

/**
 * Copy the ringtone .wav into the iOS project directory and add it to the
 * Xcode project so it's included in the app bundle. CallKit looks for the
 * sound file name (with extension) in the main bundle.
 */
function withRingtoneIos(config) {
  // Step 1: Copy the file into the iOS project directory
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectName = config.modRequest.projectName;
      const iosProjectDir = path.join(
        config.modRequest.platformProjectRoot,
        projectName,
      );
      const srcPath = path.join(config.modRequest.projectRoot, SOUND_SOURCE);
      const destPath = path.join(iosProjectDir, SOUND_FILE);

      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[with-custom-ringtone] Copied ${SOUND_FILE} to ${destPath}`);
      } else {
        console.warn(`[with-custom-ringtone] Source not found: ${srcPath}`);
      }

      return config;
    },
  ]);

  // Step 2: Add the sound file to the Xcode project's resources build phase
  config = withXcodeProject(config, (config) => {
    const projectName = config.modRequest.projectName;
    const project = config.modResults;
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName,
    });

    // Check if already added
    const hasFile = project.hasFile(`${projectName}/${SOUND_FILE}`);
    if (!hasFile) {
      const fileRefUuid = project.generateUuid();
      const buildFileUuid = project.generateUuid();

      // Add to PBXFileReference section
      project.addToPbxFileReferenceSection({
        fileRef: fileRefUuid,
        basename: SOUND_FILE,
        path: `${projectName}/${SOUND_FILE}`,
        sourceTree: '"<group>"',
        fileEncoding: undefined,
        lastKnownFileType: "audio.wav",
        group: projectName,
      });

      // Add to PBXBuildFile section
      project.addToPbxBuildFileSection({
        uuid: buildFileUuid,
        fileRef: fileRefUuid,
        basename: SOUND_FILE,
        group: projectName,
      });

      // Add to PBXResourcesBuildPhase (not Sources — it's a resource)
      const resourcesBuildPhase = project.pbxResourcesBuildPhaseObj(target.uuid);
      if (resourcesBuildPhase) {
        resourcesBuildPhase.files.push({
          value: buildFileUuid,
          comment: `${SOUND_FILE} in Resources`,
        });
      }

      // Add to the main PBXGroup
      const mainGroupKey = project.findPBXGroupKey({ name: projectName });
      if (mainGroupKey) {
        project.addToPbxGroup(
          { fileRef: fileRefUuid, basename: SOUND_FILE },
          mainGroupKey,
        );
      }

      console.log(`[with-custom-ringtone] Added ${SOUND_FILE} to Xcode project resources`);
    }

    return config;
  });

  return config;
}

/**
 * Copy the ringtone .wav into Android res/raw so it can be referenced
 * as a notification channel sound via android.resource:// URI.
 *
 * Android res/raw filenames must be lowercase with no hyphens,
 * so dvnt-ring.wav → dvnt_ring.wav
 */
function withRingtoneAndroid(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const srcPath = path.join(config.modRequest.projectRoot, SOUND_SOURCE);
      const rawDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "raw",
      );

      if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
      }

      // Android resource names: lowercase, underscores only, no hyphens
      const androidFileName = SOUND_FILE.replace(/-/g, "_");
      const destPath = path.join(rawDir, androidFileName);

      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`[with-custom-ringtone] Copied ${androidFileName} to ${destPath}`);
      } else {
        console.warn(`[with-custom-ringtone] Source not found: ${srcPath}`);
      }

      return config;
    },
  ]);
}

/**
 * Combined plugin — bundles ringtone for both platforms.
 */
function withCustomRingtone(config) {
  config = withRingtoneIos(config);
  config = withRingtoneAndroid(config);
  return config;
}

module.exports = withCustomRingtone;
