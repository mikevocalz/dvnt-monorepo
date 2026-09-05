/**
 * Expo Config Plugin: attach DVNT.storekit to the shared Xcode scheme
 *
 * StoreKit config files only apply when the app is launched from an Xcode
 * scheme, so the file sitting in apps/mobile/ is inert without this reference.
 * Debug-launch only — has no effect on EAS / Release builds.
 */

const { withDangerousMod } = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

const STOREKIT_FILE = "DVNT.storekit";

function withStoreKitConfig(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const { platformProjectRoot, projectName } = config.modRequest;
      const schemePath = path.join(
        platformProjectRoot,
        `${projectName}.xcodeproj`,
        "xcshareddata",
        "xcschemes",
        `${projectName}.xcscheme`,
      );
      if (!fs.existsSync(schemePath)) return config;

      let scheme = fs.readFileSync(schemePath, "utf8");
      if (scheme.includes("StoreKitConfigurationFileReference")) return config;

      // identifier is relative to the .xcodeproj bundle: ../../ === apps/mobile
      scheme = scheme.replace(
        "</BuildableProductRunnable>\n   </LaunchAction>",
        `</BuildableProductRunnable>
      <StoreKitConfigurationFileReference
         identifier = "../../${STOREKIT_FILE}">
      </StoreKitConfigurationFileReference>
   </LaunchAction>`,
      );
      fs.writeFileSync(schemePath, scheme);
      return config;
    },
  ]);
}

module.exports = withStoreKitConfig;
