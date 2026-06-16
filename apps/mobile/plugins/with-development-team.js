/**
 * Expo Config Plugin: Set DEVELOPMENT_TEAM for Release builds
 *
 * Personal teams (free Apple ID) cannot use App Groups, Associated Domains,
 * Push Notifications. This plugin forces the correct team so Release builds succeed.
 * Set teamId in plugin config (Micah's team).
 */

const { withXcodeProject } = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

const MICAH_TEAM_ID = "436WA3W63V";

function withDevelopmentTeam(config, { teamId } = {}) {
  const TEAM_ID =
    teamId || process.env.APPLE_DEVELOPMENT_TEAM_ID || MICAH_TEAM_ID;
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      if (key === "comment" || !configurations[key].buildSettings) continue;
      const buildSettings = configurations[key].buildSettings;
      buildSettings.DEVELOPMENT_TEAM = TEAM_ID;
    }

    const pbxPath = path.join(
      config.modRequest.platformProjectRoot,
      config.modRequest.projectName + ".xcodeproj",
      "project.pbxproj",
    );
    let contents = fs.readFileSync(pbxPath, "utf8");
    contents = contents.replace(
      /DevelopmentTeam = [^;]+;/g,
      `DevelopmentTeam = ${TEAM_ID};`,
    );
    contents = contents.replace(
      /DEVELOPMENT_TEAM = [^;]+;/g,
      `DEVELOPMENT_TEAM = ${TEAM_ID};`,
    );
    fs.writeFileSync(pbxPath, contents);

    return config;
  });
}

module.exports = withDevelopmentTeam;
