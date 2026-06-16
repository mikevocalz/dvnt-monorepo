/**
 * iOS portion of the Live Activity config plugin.
 * Adds Widget Extension target, Swift UI files, App Groups, ActivityKit.
 */

const {
  withInfoPlist,
  withXcodeProject,
  withDangerousMod,
  withEntitlementsPlist,
  IOSConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXTENSION_NAME = "DVNTHomeWidgetExtension";
const APP_GROUP_ID = "group.com.dvnt.app";
const BUNDLE_ID = "com.dvnt.app";
const EXTENSION_BUNDLE_ID = `${BUNDLE_ID}.DVNTHomeWidgetExtension`;
const DEPLOYMENT_TARGET = "16.4";

// ── Swift Source Templates (loaded from plugins/live-activity-swift/) ──

function getAttributesSwift() {
  return `import ActivityKit\nimport Foundation\n\n@available(iOS 16.1, *)\nstruct DVNTLiveAttributes: ActivityAttributes {\n    struct ContentState: Codable, Hashable {\n        var eventId: String?\n        var title: String\n        var startAt: String?\n        var venueName: String?\n        var city: String?\n        var category: String?\n        var heroLocalPath: String?\n        var isUpcoming: Bool\n        var isLive: Bool\n        var deepLink: String\n        var attendeeCount: Int?\n        var upcomingTitles: [String]\n        var upcomingStartAts: [String]\n        var upcomingVenueNames: [String]\n        var upcomingDeepLinks: [String]\n        var weatherIcon: String?\n        var weatherTempF: Int?\n        var weatherLabel: String?\n    }\n}\n`;
}

function getObjcModuleExport() {
  return `#import <React/RCTBridgeModule.h>\n\n@interface RCT_EXTERN_MODULE(DVNTLiveActivity, NSObject)\nRCT_EXTERN_METHOD(areLiveActivitiesEnabled:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)\nRCT_EXTERN_METHOD(updateLiveActivity:(NSString *)jsonPayload)\nRCT_EXTERN_METHOD(endLiveActivity)\n@end\n`;
}

// Info.plist
function withLiveActivityInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    config.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return config;
  });
}

// App Groups entitlement
function withAppGroupsEntitlement(config) {
  return withEntitlementsPlist(config, (config) => {
    if (!config.modResults["com.apple.security.application-groups"]) {
      config.modResults["com.apple.security.application-groups"] = [];
    }
    const groups = config.modResults["com.apple.security.application-groups"];
    if (!groups.includes(APP_GROUP_ID)) groups.push(APP_GROUP_ID);
    return config;
  });
}

// Write Swift files
function withLiveActivitySwiftFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectName = config.modRequest.projectName;
      const iosDir = config.modRequest.platformProjectRoot;
      const projectDir = path.join(iosDir, projectName);
      const pluginDir = path.join(__dirname, "live-activity-swift");

      // Copy pre-written Swift files from plugins/live-activity-swift/
      const swiftSrcDir = pluginDir;
      const extDir = path.join(iosDir, EXTENSION_NAME);
      fs.mkdirSync(extDir, { recursive: true });

      // If pre-written files exist, copy them; otherwise generate inline
      const swiftFiles = [
        "DVNTLiveAttributes.swift",
        "DVNTLiveActivityWidget.swift",
        "DVNTHomeWidget.swift",
        "DVNTWidgetBundle.swift",
      ];

      for (const f of swiftFiles) {
        const src = path.join(swiftSrcDir, f);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(extDir, f));
        }
      }

      // Also copy Attributes to main target (shared type)
      const attrSrc = path.join(swiftSrcDir, "DVNTLiveAttributes.swift");
      if (fs.existsSync(attrSrc)) {
        fs.copyFileSync(
          attrSrc,
          path.join(projectDir, "DVNTLiveAttributes.swift"),
        );
      } else {
        fs.writeFileSync(
          path.join(projectDir, "DVNTLiveAttributes.swift"),
          getAttributesSwift(),
          "utf-8",
        );
        fs.writeFileSync(
          path.join(extDir, "DVNTLiveAttributes.swift"),
          getAttributesSwift(),
          "utf-8",
        );
      }

      // Copy native module swift + objc bridge
      const moduleSrc = path.join(swiftSrcDir, "DVNTLiveActivityModule.swift");
      if (fs.existsSync(moduleSrc)) {
        fs.copyFileSync(
          moduleSrc,
          path.join(projectDir, "DVNTLiveActivityModule.swift"),
        );
      }
      fs.writeFileSync(
        path.join(projectDir, "DVNTLiveActivityBridge.m"),
        getObjcModuleExport(),
        "utf-8",
      );

      // Extension Info.plist — CFBundleShortVersionString must match main app
      const version = config.expo?.version ?? "1.0.0";
      const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n    <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>\n    <key>CFBundleDisplayName</key><string>DVNT Live</string>\n    <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>\n    <key>CFBundleIdentifier</key><string>${EXTENSION_BUNDLE_ID}</string>\n    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>\n    <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>\n    <key>CFBundlePackageType</key><string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>\n    <key>CFBundleShortVersionString</key><string>${version}</string>\n    <key>CFBundleVersion</key><string>1</string>\n    <key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>\n    <key>NSSupportsLiveActivities</key><true/>\n</dict>\n</plist>`;
      fs.writeFileSync(path.join(extDir, "Info.plist"), plist, "utf-8");

      // Extension entitlements (App Groups + network for AsyncImage URL loading)
      const ent = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n    <key>com.apple.security.application-groups</key>\n    <array><string>${APP_GROUP_ID}</string></array>\n    <key>com.apple.security.network.client</key>\n    <true/>\n</dict>\n</plist>`;
      fs.writeFileSync(
        path.join(extDir, `${EXTENSION_NAME}.entitlements`),
        ent,
        "utf-8",
      );

      // Copy dvnt_logo asset for Widget UI (required by DVNTLiveActivityWidget.swift)
      const projectRoot = path.join(__dirname, "..");
      const iconSrc = path.join(
        projectRoot,
        "assets",
        "images",
        "ios-icon.png",
      );
      const assetDir = path.join(extDir, "Assets.xcassets");
      const logoDir = path.join(assetDir, "dvnt_logo.imageset");
      fs.mkdirSync(logoDir, { recursive: true });
      if (fs.existsSync(iconSrc)) {
        const dest = path.join(logoDir, "icon.png");
        fs.copyFileSync(iconSrc, dest);
        fs.writeFileSync(
          path.join(logoDir, "Contents.json"),
          JSON.stringify(
            {
              images: [
                { filename: "icon.png", idiom: "universal", scale: "1x" },
                { filename: "icon.png", idiom: "universal", scale: "2x" },
                { filename: "icon.png", idiom: "universal", scale: "3x" },
              ],
              info: { author: "xcode", version: 1 },
            },
            null,
            2,
          ),
          "utf-8",
        );
      }

      const glyphDir = path.join(assetDir, "dvnt_logo_glyph.imageset");
      fs.mkdirSync(glyphDir, { recursive: true });
      const glyphSrc = path.join(
        projectRoot,
        "assets",
        "images",
        "dvnt-glyph.png",
      );
      const glyphSource = fs.existsSync(glyphSrc) ? glyphSrc : iconSrc;
      if (fs.existsSync(glyphSource)) {
        fs.copyFileSync(glyphSource, path.join(glyphDir, "icon.png"));
        fs.writeFileSync(
          path.join(glyphDir, "Contents.json"),
          JSON.stringify(
            {
              images: [
                { filename: "icon.png", idiom: "universal", scale: "1x" },
                { filename: "icon.png", idiom: "universal", scale: "2x" },
                { filename: "icon.png", idiom: "universal", scale: "3x" },
              ],
              info: { author: "xcode", version: 1 },
            },
            null,
            2,
          ),
          "utf-8",
        );
      }

      console.log(`[with-live-activity] Wrote iOS files`);
      return config;
    },
  ]);
}

// Creates Widget Extension Xcode target + adds native module files to main target.
function withWidgetExtensionTarget(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const projectName = config.modRequest.projectName;
    const version = config.expo?.version ?? "1.0.0";
    const dominated = /_comment$/;

    // ── Part 1: Create Widget Extension Target ─────────────────────
    const nativeTargets = project.pbxNativeTargetSection() || {};
    let extUuid = null;

    for (const key of Object.keys(nativeTargets)) {
      if (dominated.test(key)) continue;
      const name = (nativeTargets[key].name || "").replace(/"/g, "");
      if (name === EXTENSION_NAME) {
        extUuid = key;
        break;
      }
    }

    if (!extUuid) {
      try {
        const t = project.addTarget(
          EXTENSION_NAME,
          "app_extension",
          EXTENSION_NAME,
          EXTENSION_BUNDLE_ID,
        );
        if (t && t.uuid) extUuid = t.uuid;
      } catch (e) {
        console.error("[with-live-activity] addTarget failed:", e.message);
      }
    }

    if (extUuid) {
      // Sources build phase
      const extFiles = [
        `${EXTENSION_NAME}/DVNTLiveAttributes.swift`,
        `${EXTENSION_NAME}/DVNTLiveActivityWidget.swift`,
        `${EXTENSION_NAME}/DVNTHomeWidget.swift`,
        `${EXTENSION_NAME}/DVNTWidgetBundle.swift`,
      ];
      try {
        project.addBuildPhase(
          extFiles,
          "PBXSourcesBuildPhase",
          "Sources",
          extUuid,
        );
      } catch (e) {
        console.warn("[with-live-activity] Sources phase:", e.message);
      }

      // Frameworks build phase
      try {
        project.addBuildPhase(
          [],
          "PBXFrameworksBuildPhase",
          "Frameworks",
          extUuid,
        );
      } catch (e) {
        console.warn("[with-live-activity] Frameworks phase:", e.message);
      }

      // Resources build phase
      try {
        project.addBuildPhase(
          [`${EXTENSION_NAME}/Assets.xcassets`],
          "PBXResourcesBuildPhase",
          "Resources",
          extUuid,
        );
      } catch (e) {
        console.warn("[with-live-activity] Resources phase:", e.message);
      }

      // Build settings for extension target
      const tObj = project.pbxNativeTargetSection()[extUuid];
      const clUuid = tObj?.buildConfigurationList;
      if (clUuid) {
        const cl = (project.pbxXCConfigurationList() || {})[clUuid];
        const refs = cl?.buildConfigurations || [];
        const cfgs = project.pbxXCBuildConfigurationSection() || {};
        for (const ref of refs) {
          const c = cfgs[ref.value];
          if (!c?.buildSettings) continue;
          const bs = c.buildSettings;
          bs.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
          bs.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
          bs.SWIFT_VERSION = "5.0";
          bs.IPHONEOS_DEPLOYMENT_TARGET = `"${DEPLOYMENT_TARGET}"`;
          bs.TARGETED_DEVICE_FAMILY = `"1,2"`;
          bs.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
          bs.MARKETING_VERSION = `"${version}"`;
          bs.CURRENT_PROJECT_VERSION = "1";
          bs.GENERATE_INFOPLIST_FILE = "YES";
          bs.SWIFT_EMIT_LOC_STRINGS = "YES";
          bs.SKIP_INSTALL = "YES";
        }
      }

      // Embedding + code signing handled by EAS via appExtensions in app.config.js.
      // Manual addBuildPhase for PBXCopyFilesBuildPhase creates orphaned file refs
      // that break Xcodeproj consistency checks in CocoaPods post_install.

      console.log(
        `[with-live-activity] Widget Extension target ready: ${extUuid}`,
      );
    }

    // ── Part 2: Suppress non-modular header warnings ───────────────
    const allConfigs = Object.keys(project.pbxXCBuildConfigurationSection())
      .filter((k) => !dominated.test(k))
      .reduce((acc, k) => {
        acc[k] = project.pbxXCBuildConfigurationSection()[k];
        return acc;
      }, {});
    for (const key in allConfigs) {
      const bs = allConfigs[key].buildSettings;
      if (bs && bs["PRODUCT_NAME"]) {
        bs["CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES"] = "YES";
      }
    }

    // ── Part 3: Add native module files to main target ─────────────
    const nativeFiles = [
      { name: "DVNTLiveActivityModule.swift", type: "sourcecode.swift" },
      { name: "DVNTLiveActivityBridge.m", type: "sourcecode.c.objc" },
      { name: "DVNTLiveAttributes.swift", type: "sourcecode.swift" },
    ];
    for (const file of nativeFiles) {
      const hasFile = project.hasFile(`${projectName}/${file.name}`);
      if (!hasFile) {
        const fileRefUuid = project.generateUuid();
        const buildFileUuid = project.generateUuid();
        project.addToPbxFileReferenceSection({
          fileRef: fileRefUuid,
          basename: file.name,
          path: `${projectName}/${file.name}`,
          sourceTree: '"<group>"',
          fileEncoding: 4,
          lastKnownFileType: file.type,
          group: projectName,
        });
        project.addToPbxBuildFileSection({
          uuid: buildFileUuid,
          fileRef: fileRefUuid,
          basename: file.name,
          group: projectName,
        });
        project.addToPbxSourcesBuildPhase({
          uuid: buildFileUuid,
          fileRef: fileRefUuid,
          basename: file.name,
          group: projectName,
        });
        const mainGroupKey = project.findPBXGroupKey({ name: projectName });
        if (mainGroupKey) {
          project.addToPbxGroup(
            { fileRef: fileRefUuid, basename: file.name },
            mainGroupKey,
          );
        }
      }
    }

    console.log(
      "[with-live-activity] Native module files added to main target",
    );
    return config;
  });
}

module.exports = {
  withLiveActivityInfoPlist,
  withAppGroupsEntitlement,
  withLiveActivitySwiftFiles,
  withWidgetExtensionTarget,
};
