/**
 * Expo Config Plugin: Disable User Script Sandboxing
 *
 * Xcode 15+ enables user script sandboxing by default, which can break
 * build scripts that write temp files (e.g. ip.txt from dev launcher).
 * Setting ENABLE_USER_SCRIPT_SANDBOXING = NO fixes these build failures.
 */

const { withXcodeProject } = require("expo/config-plugins");

function withDisableUserScriptSandboxing(config) {
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      if (key === "comment" || !configurations[key].buildSettings) continue;
      const buildSettings = configurations[key].buildSettings;
      if (buildSettings.ENABLE_USER_SCRIPT_SANDBOXING !== undefined) {
        buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      }
    }

    return config;
  });
}

module.exports = withDisableUserScriptSandboxing;
