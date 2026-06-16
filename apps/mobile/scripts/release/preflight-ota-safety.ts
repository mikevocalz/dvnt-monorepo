#!/usr/bin/env tsx
/**
 * DVNT OTA Safety Preflight — scripts/release/preflight-ota-safety.ts
 *
 * Run BEFORE every `eas update` to prevent shipping native-only changes as OTA.
 *
 * Usage:
 *   npx tsx scripts/release/preflight-ota-safety.ts [--channel production|preview]
 *
 * Exit codes:
 *   0 — OTA SAFE: proceed with eas update
 *   1 — NATIVE BUILD REQUIRED or BLOCKED
 *
 * Decision printed as one of:
 *   ✅ OTA SAFE
 *   🔨 NATIVE BUILD REQUIRED
 *   🚫 BLOCKED: NEED HUMAN REVIEW
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "../..");
const channel = process.argv.find((a) => a.startsWith("--channel="))?.split("=")[1] ?? "production";

let errors: string[] = [];
let warnings: string[] = [];
let requiresNativeBuild = false;
let blocked = false;

function fail(msg: string): void {
  errors.push(msg);
  requiresNativeBuild = true;
}

function block(msg: string): void {
  errors.push(`BLOCKED: ${msg}`);
  blocked = true;
}

function warn(msg: string): void {
  warnings.push(msg);
}

// ── 1. Git status — detect changed files ─────────────────────────────────────

function getChangedFiles(base: string = "HEAD~1"): string[] {
  try {
    const diff = execSync(`git diff --name-only ${base} HEAD 2>/dev/null`, {
      cwd: ROOT,
      encoding: "utf-8",
    }).trim();
    if (!diff) return [];
    return diff.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch {
    // Fallback: compare working tree
    try {
      const status = execSync(`git status --porcelain 2>/dev/null`, {
        cwd: ROOT,
        encoding: "utf-8",
      }).trim();
      if (!status) return [];
      return status.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
    } catch {
      warn("Could not determine changed files — assuming safe");
      return [];
    }
  }
}

// ── 2. Native-affecting file patterns ─────────────────────────────────────────

const NATIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^ios\//,                             reason: "iOS native directory changed" },
  { pattern: /^android\//,                         reason: "Android native directory changed" },
  { pattern: /Podfile(\.lock)?$/,                  reason: "Podfile/Podfile.lock changed" },
  { pattern: /\.podspec$/,                         reason: "Podspec changed" },
  { pattern: /build\.gradle/,                      reason: "Android build.gradle changed" },
  { pattern: /AndroidManifest\.xml/,               reason: "AndroidManifest changed" },
  { pattern: /\.pbxproj$/,                         reason: "Xcode project file changed" },
  { pattern: /\.xcconfig$/,                        reason: "Xcode config changed" },
  { pattern: /\.entitlements$/,                    reason: "iOS entitlements changed" },
  { pattern: /\.swift$/,                           reason: "Swift file changed" },
  { pattern: /\.(m|mm|h)$/,                        reason: "Objective-C file changed" },
  { pattern: /\.kt$/,                              reason: "Kotlin file changed" },
  { pattern: /app\.config\.(ts|js)$/,              reason: "app.config changed (may affect plugins)" },
  { pattern: /app\.json$/,                         reason: "app.json changed" },
  { pattern: /plugins\//,                          reason: "Config plugin changed" },
  { pattern: /modules\//,                          reason: "Native module changed" },
  { pattern: /^package\.json$/,                    reason: "package.json changed (check native deps)" },
  { pattern: /^package-lock\.json$/,               reason: "package-lock.json changed" },
  { pattern: /^yarn\.lock$/,                       reason: "yarn.lock changed" },
  { pattern: /^bun\.lockb$/,                       reason: "bun.lockb changed" },
  { pattern: /expo-updates/,                       reason: "expo-updates config changed" },
  { pattern: /eas\.json$/,                         reason: "eas.json changed (verify channel/runtime)" },
];

// ── 3. Package.json native dep check ──────────────────────────────────────────

// Known native packages (require native build when added/removed)
const KNOWN_NATIVE_PACKAGES = [
  "expo-camera", "expo-video", "expo-audio", "expo-notifications",
  "expo-updates", "expo-secure-store", "expo-location", "expo-maps",
  "expo-image-picker", "expo-media-library", "expo-screen-orientation",
  "react-native-vision-camera", "react-native-mmkv", "react-native-gesture-handler",
  "react-native-reanimated", "react-native-screens", "react-native-pager-view",
  "react-native-callkeep", "react-native-incall-manager", "@stripe/stripe-react-native",
  "@supabase/supabase-js", "@shopify/react-native-skia", "@fishjam-cloud/react-native-client",
  "@callstack/liquid-glass", "@bam.tech/react-native-app-security",
  "react-native-nitro-modules", "react-native-nitro-image", "react-native-video",
  "react-native-compressor", "@regulaforensics/react-native-face-api",
  "expo-share-intent", "@config-plugins/react-native-webrtc",
];

function checkPackageJsonChanges(changedFiles: string[]): void {
  if (!changedFiles.includes("package.json")) return;

  // Read current and baseline package.json
  const current = safeReadJson(path.join(ROOT, "package.json"));
  if (!current) return;

  // Try to read baseline from git
  let baseline: any = null;
  try {
    const raw = execSync("git show HEAD~1:package.json", {
      cwd: ROOT,
      encoding: "utf-8",
    });
    baseline = JSON.parse(raw);
  } catch {
    warn("Could not read previous package.json — checking for known native deps in current");
    // Can't diff, just flag
    fail("package.json changed — verify no native packages were added/removed");
    return;
  }

  const currentDeps = { ...current.dependencies, ...current.devDependencies };
  const baselineDeps = { ...baseline.dependencies, ...baseline.devDependencies };

  const added = Object.keys(currentDeps).filter(
    (k) => !(k in baselineDeps) && KNOWN_NATIVE_PACKAGES.includes(k)
  );
  const removed = Object.keys(baselineDeps).filter(
    (k) => !(k in currentDeps) && KNOWN_NATIVE_PACKAGES.includes(k)
  );

  if (added.length > 0) {
    fail(`Native packages ADDED: ${added.join(", ")} — native build required`);
  }
  if (removed.length > 0) {
    fail(`Native packages REMOVED: ${removed.join(", ")} — native build required`);
  }
}

// ── 4. Runtime version check ───────────────────────────────────────────────────

function checkRuntimeVersion(): void {
  const appConfig = safeReadJson(path.join(ROOT, "app.config.js")) ??
                    safeReadJson(path.join(ROOT, "app.json"));

  // Read from eas.json update channel
  const easJson = safeReadJson(path.join(ROOT, "eas.json"));
  if (!easJson) {
    warn("Could not read eas.json");
    return;
  }

  const updateChannel = easJson?.update?.[channel] ?? easJson?.build?.[channel];
  // Can only validate if EAS exposes it; mostly this is a human check
}

// ── 5. Channel isolation check ─────────────────────────────────────────────────

function checkChannelIsolation(): void {
  const easJson = safeReadJson(path.join(ROOT, "eas.json"));
  if (!easJson?.build) return;

  // Warn: apk profile on production channel (internal builds getting prod OTAs)
  const apkProfile = easJson.build?.apk;
  if (apkProfile?.channel === "production") {
    warn(
      "apk build profile uses channel 'production' — internal Android testers " +
      "receive production OTA updates. Consider using channel 'preview' for apk builds."
    );
  }

  // Block: dev client getting production updates
  const devProfile = easJson.build?.development;
  if (devProfile?.developmentClient && devProfile?.channel === "production") {
    block("development build profile uses channel 'production' — dev client must not receive production OTAs");
  }
}

// ── 6. Verify Updates.url is correct ─────────────────────────────────────────

function checkUpdatesConfig(): void {
  let appConfigContent = "";
  try {
    appConfigContent = fs.readFileSync(path.join(ROOT, "app.config.js"), "utf-8");
  } catch {
    try {
      appConfigContent = fs.readFileSync(path.join(ROOT, "app.json"), "utf-8");
    } catch {
      warn("Could not read app config");
      return;
    }
  }

  const projectId = "5c0d13a3-c544-4ffc-ae8f-8e897dda2663";
  const expectedUrl = `https://u.expo.dev/${projectId}`;

  if (!appConfigContent.includes(expectedUrl)) {
    warn(`updates.url does not match expected: ${expectedUrl}`);
  }

  if (!appConfigContent.includes(`"1.0.0"`) && !appConfigContent.includes("'1.0.0'")) {
    warn("runtimeVersion '1.0.0' not found in app config — verify runtime version policy");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeReadJson(filePath: string): any {
  try {
    // For .js configs, we can't safely eval, so skip
    if (filePath.endsWith(".js") || filePath.endsWith(".ts")) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  DVNT OTA Safety Preflight                            ║");
  console.log(`╚══════════════════════════════════════════════════════╝`);
  console.log(`Channel: ${channel}\n`);

  const changedFiles = getChangedFiles();
  console.log(`Changed files (${changedFiles.length}):`);
  changedFiles.forEach((f) => console.log(`  ${f}`));
  console.log();

  // Check each changed file against native patterns
  for (const file of changedFiles) {
    for (const { pattern, reason } of NATIVE_PATTERNS) {
      if (pattern.test(file)) {
        fail(`${reason}: ${file}`);
        break;
      }
    }
  }

  checkPackageJsonChanges(changedFiles);
  checkRuntimeVersion();
  checkChannelIsolation();
  checkUpdatesConfig();

  // ── Print results ─────────────────────────────────────────────────

  if (warnings.length > 0) {
    console.log("Warnings:");
    warnings.forEach((w) => console.log(`  ⚠️  ${w}`));
    console.log();
  }

  if (errors.length > 0) {
    console.log("Issues found:");
    errors.forEach((e) => console.log(`  ❌ ${e}`));
    console.log();
  }

  // ── Decision ──────────────────────────────────────────────────────

  if (blocked) {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  🚫 BLOCKED: NEED HUMAN REVIEW                        ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");
    process.exit(1);
  }

  if (requiresNativeBuild) {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  🔨 NATIVE BUILD REQUIRED                             ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("\nRun native build:");
    console.log("  npx eas-cli build --platform ios --profile production --auto-submit");
    console.log("  npx eas-cli build --platform android --profile production\n");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ✅ OTA SAFE — proceed with eas update                 ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\nPublish commands:");
  console.log(`  # Preview OTA:`);
  console.log(`  EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli update --branch preview --message "<desc>" --platform ios --environment preview`);
  console.log(`  # Production OTA:`);
  console.log(`  EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli update --branch production --message "<desc>" --platform ios --environment production\n`);

  process.exit(0);
}

main();
