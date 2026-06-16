const { withXcodeProject } = require("expo/config-plugins");
const plist = require("@expo/plist").default;
const fs = require("fs");
const path = require("path");

const SHARE_EXTENSION_INFO_PLIST = "ShareExtension/ShareExtension-Info.plist";

function withShareExtensionBuildSettings(config) {
  return withXcodeProject(config, (config) => {
    const infoPlistPath = path.join(
      config.modRequest.platformProjectRoot,
      SHARE_EXTENSION_INFO_PLIST,
    );
    const configurations = config.modResults.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      if (key === "comment" || !configurations[key]?.buildSettings) {
        continue;
      }

      const buildSettings = configurations[key].buildSettings;
      const infoPlistFile = String(buildSettings.INFOPLIST_FILE ?? "").replace(
        /"/g,
        "",
      );

      if (infoPlistFile !== SHARE_EXTENSION_INFO_PLIST) {
        continue;
      }

      buildSettings.GENERATE_INFOPLIST_FILE = "NO";
      buildSettings.MARKETING_VERSION = `"${config.expo?.version ?? "1.0.0"}"`;
      buildSettings.CURRENT_PROJECT_VERSION =
        buildSettings.CURRENT_PROJECT_VERSION ?? "1";
    }

    if (!fs.existsSync(infoPlistPath)) {
      console.warn(
        `[with-share-extension-version-sync] Missing ${SHARE_EXTENSION_INFO_PLIST}, skipping plist patch`,
      );
      return config;
    }

    const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, "utf8"));
    infoPlist.CFBundleShortVersionString = config.expo?.version ?? "1.0.0";
    infoPlist.CFBundleVersion = infoPlist.CFBundleVersion ?? "1";
    fs.writeFileSync(infoPlistPath, plist.build(infoPlist));

    return config;
  });
}

module.exports = function withShareExtensionVersionSync(config) {
  return withShareExtensionBuildSettings(config);
};
