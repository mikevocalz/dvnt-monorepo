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
import { NATIVE_PATTERNS as SHARED_NATIVE_PATTERNS } from "./native-patterns";

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

/**
 * The commit the installed build was made from — the only baseline that answers
 * "can an OTA reach the people already running this app?".
 *
 * The default used to be `HEAD~1`, which answers a different and much weaker
 * question: "did the LAST COMMIT touch anything native?". On 2026-09-09 that
 * reported OTA SAFE while `react-native-google-mobile-ads` — a native module
 * added six commits earlier in 18bebe0 — had already moved the production
 * fingerprint off every installed build. An update published on that verdict
 * would have reported "Published!" and reached nobody.
 *
 * Pass `--base=<sha>` with the commit of the newest finished build on the
 * channel (`eas build:list --platform ios --limit 1`). Without it this falls
 * back to HEAD~1 and the verdict is downgraded to advisory, because a one-commit
 * window cannot see a native change that landed before it.
 */
const baseArg = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1];
const baselineIsTrustworthy = Boolean(baseArg);

function getChangedFiles(base: string = baseArg ?? "HEAD~1"): string[] {
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

// Shared with check-native-diff via native-patterns.ts. This file used to
// keep its own copy, which listed npm/yarn/bun lockfiles but not pnpm's and
// anchored package.json at the repo root.
const NATIVE_PATTERNS = SHARED_NATIVE_PATTERNS.map(({ pattern, category }) => ({
  pattern,
  reason: `${category} changed`,
}));


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

/**
 * Repo-root-relative path of the package.json this check is about.
 *
 * ROOT is apps/mobile, but `git diff --name-only` and `git show <rev>:<path>`
 * both resolve from the REPOSITORY root no matter what cwd they are handed. So
 * `changedFiles.includes("package.json")` matched the workspace root file — the
 * one with zero dependencies — while `safeReadJson(ROOT/package.json)` read
 * apps/mobile's 151. Every native dependency therefore looked newly ADDED on
 * any run where the root package.json happened to change.
 *
 * This is the same root-vs-app drift 0866208 fixed in NATIVE_PATTERNS; it
 * survived here because this check builds its own paths.
 */
const MOBILE_PKG_PATH = "apps/mobile/package.json";

function checkPackageJsonChanges(changedFiles: string[]): void {
  if (!changedFiles.includes(MOBILE_PKG_PATH)) return;

  // Read current and baseline package.json
  const current = safeReadJson(path.join(ROOT, "package.json"));
  if (!current) return;

  // Try to read baseline from git
  let baseline: any = null;
  try {
    const raw = execSync(`git show ${baseArg ?? "HEAD~1"}:${MOBILE_PKG_PATH}`, {
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

  if (!baselineIsTrustworthy) {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║  ⚠️  INCONCLUSIVE — no --base given                   ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("\nNothing native changed between HEAD~1 and HEAD, which is NOT");
    console.log("the same as 'an OTA will reach installed builds'. A native");
    console.log("dependency added any earlier is invisible from a one-commit");
    console.log("window — that is how 18bebe0 (react-native-google-mobile-ads)");
    console.log("passed this check on 2026-09-09 while having already moved the");
    console.log("production fingerprint off every installed build.\n");
    console.log("Re-run against the commit the installed build was made from:");
    console.log("  npx eas-cli build:list --platform ios --limit 1   # note its commit");
    console.log("  npx tsx apps/mobile/scripts/release/preflight-ota-safety.ts --base=<sha>\n");
    console.log("And confirm with the authoritative check — the fingerprint:");
    console.log("  APP_ENV=production npx eas-cli fingerprint:compare <build-runtimeVersion> --environment production\n");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  ✅ OTA SAFE — proceed with eas update                 ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\nBaseline: ${baseArg}`);
  console.log("\nA clean file diff is necessary, not sufficient. The fingerprint");
  console.log("is what decides delivery — confirm it matches the installed build:");
  console.log("  APP_ENV=production npx eas-cli fingerprint:compare <build-runtimeVersion> --environment production");
  console.log("\nPublish commands:");
  console.log(`  # Preview OTA:`);
  console.log(`  EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli update --branch preview --message "<desc>" --platform ios --environment preview`);
  console.log(`  # Production OTA:`);
  console.log(`  EAS_SKIP_AUTO_FINGERPRINT=1 npx eas-cli update --branch production --message "<desc>" --platform ios --environment production\n`);

  process.exit(0);
}

main();
