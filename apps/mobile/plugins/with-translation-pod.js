/**
 * Expo Config Plugin: Link the local @deviant/translation Expo module pod.
 *
 * expo-modules-autolinking discovers the pod via the pnpm workspace symlink at
 * node_modules/@deviant/translation, but EAS build workers can have trouble
 * resolving workspace symlinks during pod install. This plugin adds an explicit
 * pod reference as a fallback, which is a no-op if autolinking already added it.
 */
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withTranslationPod(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let contents = fs.readFileSync(podfilePath, "utf8");

      const marker = "use_expo_modules!";
      const podLine =
        "  pod 'Translation', :path => '../modules/translation'";

      if (
        contents.includes(marker) &&
        !contents.includes("pod 'Translation'")
      ) {
        contents = contents.replace(
          marker,
          `${marker}\n${podLine}`
        );
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
}

module.exports = withTranslationPod;
