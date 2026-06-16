/**
 * Expo Config Plugin: Disable VisionCamera Frame Processors
 *
 * Sets $VCEnableFrameProcessors = false in the Podfile so VisionCamera
 * does not pull in react-native-worklets-core as a CocoaPods dependency.
 * Frame processors are not used in this project.
 */

const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withDisableFrameProcessors(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );

      let podfile = fs.readFileSync(podfilePath, "utf8");

      const marker = "$VCEnableFrameProcessors = false";

      if (!podfile.includes(marker)) {
        // Insert before the first `target` line
        podfile = podfile.replace(
          /^(target\s)/m,
          `# Disable VisionCamera Frame Processors (no worklets-core needed)\n${marker}\n\n$1`
        );
        fs.writeFileSync(podfilePath, podfile, "utf8");
      }

      return config;
    },
  ]);
}

module.exports = withDisableFrameProcessors;
