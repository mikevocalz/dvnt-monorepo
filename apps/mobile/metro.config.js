const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

// ── Monorepo (PROMPT 0 §4.1) ──────────────────────────────────────────────
// Watch the repo root so Metro sees workspace package source (packages/*), and
// resolve modules from BOTH the app and the hoisted root node_modules
// (node-linker=hoisted moves most deps to the root).
const monorepoRoot = path.resolve(__dirname, "../..");
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

config.resolver.assetExts.push("riv");

// Fix for react-native-pager-view commonjs/esm resolution
config.resolver.unstable_enablePackageExports = true;

// Map native packages to their server-side shim files
const configuredNativePackageShims = {
  "react-native-reanimated": path.resolve(
    __dirname,
    "shims/react-native-reanimated.js",
  ),
  "react-native-gesture-handler": path.resolve(
    __dirname,
    "shims/react-native-gesture-handler.js",
  ),
  "react-native-safe-area-context": path.resolve(
    __dirname,
    "shims/react-native-safe-area-context.js",
  ),
  "react-native-keyboard-controller": path.resolve(
    __dirname,
    "shims/react-native-keyboard-controller.js",
  ),
  "react-native-animated-glow": path.resolve(
    __dirname,
    "shims/react-native-animated-glow.js",
  ),
  "@gorhom/bottom-sheet": path.resolve(
    __dirname,
    "shims/gorhom-bottom-sheet.js",
  ),
  "react-native-pager-view": path.resolve(
    __dirname,
    "shims/react-native-pager-view.js",
  ),
  "@lodev09/react-native-true-sheet": path.resolve(
    __dirname,
    "shims/lodev09-true-sheet.js",
  ),
  "react-native-vision-camera": path.resolve(
    __dirname,
    "shims/react-native-vision-camera.js",
  ),
  "expo-notifications": path.resolve(__dirname, "shims/expo-notifications.js"),
  "expo-secure-store": path.resolve(__dirname, "shims/expo-secure-store.js"),
  "expo-image": path.resolve(__dirname, "shims/expo-image.js"),
  "expo-video": path.resolve(__dirname, "shims/expo-video.js"),
  "expo-linear-gradient": path.resolve(
    __dirname,
    "shims/expo-linear-gradient.js",
  ),
  "expo-font": path.resolve(__dirname, "shims/expo-font.js"),
  "expo-splash-screen": path.resolve(__dirname, "shims/expo-splash-screen.js"),
  "expo-image-picker": path.resolve(__dirname, "shims/expo-image-picker.js"),
  "expo-media-library": path.resolve(__dirname, "shims/expo-media-library.js"),
};

const nativePackageShims = Object.fromEntries(
  Object.entries(configuredNativePackageShims).filter(([, shimPath]) =>
    fs.existsSync(shimPath),
  ),
);

// Track if we're bundling for server (set when getServerManifest is the entry)
let isServerBundleMode = false;

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Detect server manifest entry point and enable server mode
  if (
    moduleName.includes("getServerManifest") ||
    context.originModulePath?.includes("getServerManifest")
  ) {
    isServerBundleMode = true;
  }

  // Reset flag when we hit a new entry point (index.js)
  if (moduleName === "." && !context.originModulePath) {
    isServerBundleMode = false;
  }

  // Use shims in server bundle mode
  if (isServerBundleMode) {
    for (const [pkg, shimPath] of Object.entries(nativePackageShims)) {
      if (moduleName === pkg || moduleName.startsWith(pkg + "/")) {
        return { type: "sourceFile", filePath: shimPath };
      }
    }
  }

  // Fix: @better-auth/core uses internal subpath imports like @better-auth/core/utils/json
  // and @better-auth/core/utils/error-codes that are NOT in its exports map.
  // Metro with unstable_enablePackageExports=true rejects them. Resolve directly to dist files.
  if (moduleName.startsWith("@better-auth/core/")) {
    const subpath = moduleName.slice("@better-auth/core/".length); // e.g. "utils/json"
    // Try both the app and the hoisted root node_modules (§4.1) — hoisting may
    // place @better-auth/core at either location.
    for (const base of [__dirname, monorepoRoot]) {
      const distFile = path.resolve(
        base,
        "node_modules/@better-auth/core/dist",
        subpath + ".mjs",
      );
      try {
        require.resolve(distFile);
        return { type: "sourceFile", filePath: distFile };
      } catch (_) {
        // try next base / fall through to default resolution
      }
    }
  }

  // Fix: event-target-shim@6 exports only "." but Fishjam WebRTC imports
  // "event-target-shim/index" which isn't in the exports map.
  // Rewrite to the root specifier so the exports field resolves correctly.
  if (moduleName === "event-target-shim/index") {
    const rewritten = "event-target-shim";
    if (originalResolveRequest) {
      return originalResolveRequest(context, rewritten, platform);
    }
    return context.resolveRequest(context, rewritten, platform);
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativewind(config, { input: "./global.css" });
