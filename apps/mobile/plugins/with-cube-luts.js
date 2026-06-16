/**
 * Expo Config Plugin: Bundle .cube LUT files into iOS and Android builds
 *
 * iOS: Creates a CubeLUTs.bundle in the Xcode project resources
 * Android: Copies .cube files into android/app/src/main/assets/luts/
 *
 * Place .cube files in assets/luts/ and they will be automatically bundled.
 */

const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const LUTS_SOURCE_DIR = "assets/luts";

/** Copy .cube files into Android assets/luts/ */
function withAndroidCubeLUTs(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourceDir = path.join(projectRoot, LUTS_SOURCE_DIR);
      const targetDir = path.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "assets",
        "luts",
      );

      if (!fs.existsSync(sourceDir)) {
        console.log(
          "[with-cube-luts] No assets/luts/ directory found, skipping Android",
        );
        return config;
      }

      // Create target directory
      fs.mkdirSync(targetDir, { recursive: true });

      // Copy .cube files
      const files = fs
        .readdirSync(sourceDir)
        .filter((f) => f.endsWith(".cube"));
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dst = path.join(targetDir, file);
        fs.copyFileSync(src, dst);
        console.log(`[with-cube-luts] Android: copied ${file}`);
      }

      console.log(
        `[with-cube-luts] Android: ${files.length} .cube files bundled`,
      );
      return config;
    },
  ]);
}

/** Copy .cube files into iOS CubeLUTs.bundle and add to Xcode project */
function withIOSCubeLUTs(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourceDir = path.join(projectRoot, LUTS_SOURCE_DIR);
      const platformProjectRoot = config.modRequest.platformProjectRoot;
      const bundleDir = path.join(platformProjectRoot, "CubeLUTs.bundle");

      if (!fs.existsSync(sourceDir)) {
        console.log(
          "[with-cube-luts] No assets/luts/ directory found, skipping iOS",
        );
        return config;
      }

      // Create CubeLUTs.bundle directory
      fs.mkdirSync(bundleDir, { recursive: true });

      // Copy .cube files into the bundle
      const files = fs
        .readdirSync(sourceDir)
        .filter((f) => f.endsWith(".cube"));
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dst = path.join(bundleDir, file);
        fs.copyFileSync(src, dst);
        console.log(`[with-cube-luts] iOS: copied ${file}`);
      }

      console.log(
        `[with-cube-luts] iOS: ${files.length} .cube files bundled into CubeLUTs.bundle`,
      );
      return config;
    },
  ]);
}

/** Add CubeLUTs.bundle to Xcode project resources */
function withXcodeCubeLUTs(config) {
  return withXcodeProject(config, async (config) => {
    const project = config.modResults;
    const projectRoot = config.modRequest.projectRoot;
    const sourceDir = path.join(projectRoot, LUTS_SOURCE_DIR);

    if (!fs.existsSync(sourceDir)) {
      return config;
    }

    const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".cube"));
    if (files.length === 0) {
      return config;
    }

    // Add CubeLUTs.bundle as a resource to the main target
    const bundlePath = "CubeLUTs.bundle";

    // Check if already added
    const existingResources = project.pbxResourcesBuildPhaseObj(
      project.getFirstTarget().uuid,
    );

    if (existingResources) {
      const alreadyAdded = existingResources.files?.some((f) => {
        const fileRef = project.pbxFileReferenceSection()[f.value?.fileRef];
        return fileRef && fileRef.path && fileRef.path.includes("CubeLUTs");
      });

      if (!alreadyAdded) {
        try {
          project.addResourceFile(bundlePath, {
            target: project.getFirstTarget().uuid,
          });
          console.log(
            "[with-cube-luts] iOS: Added CubeLUTs.bundle to Xcode resources",
          );
        } catch (e) {
          console.warn(
            "[with-cube-luts] iOS: Could not add CubeLUTs.bundle to Xcode resources:",
            e.message,
          );
        }
      }
    }

    return config;
  });
}

/** Combined plugin */
function withCubeLUTs(config) {
  config = withAndroidCubeLUTs(config);
  config = withIOSCubeLUTs(config);
  config = withXcodeCubeLUTs(config);
  return config;
}

module.exports = withCubeLUTs;
