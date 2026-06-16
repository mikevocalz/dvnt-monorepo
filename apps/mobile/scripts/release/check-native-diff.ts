#!/usr/bin/env tsx
/**
 * DVNT Native Change Detector — scripts/release/check-native-diff.ts
 *
 * Prints a categorized list of native vs JS changes between two git refs.
 * Used by CI and the preflight script.
 *
 * Usage:
 *   npx tsx scripts/release/check-native-diff.ts [base] [head]
 *   npx tsx scripts/release/check-native-diff.ts HEAD~1 HEAD
 *   npx tsx scripts/release/check-native-diff.ts main feature/my-branch
 */

import { execSync } from "child_process";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const base = process.argv[2] ?? "HEAD~1";
const head = process.argv[3] ?? "HEAD";

const NATIVE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /^ios\//,                category: "iOS native" },
  { pattern: /^android\//,            category: "Android native" },
  { pattern: /Podfile(\.lock)?$/,     category: "CocoaPods" },
  { pattern: /build\.gradle/,         category: "Android build" },
  { pattern: /AndroidManifest\.xml/,  category: "Android manifest" },
  { pattern: /\.pbxproj$/,            category: "Xcode project" },
  { pattern: /\.entitlements$/,       category: "iOS entitlements" },
  { pattern: /\.swift$/,              category: "Swift" },
  { pattern: /\.(m|mm|h)$/,           category: "Objective-C" },
  { pattern: /\.kt$/,                 category: "Kotlin" },
  { pattern: /app\.config\.(ts|js)$/, category: "Expo config" },
  { pattern: /app\.json$/,            category: "Expo config" },
  { pattern: /^plugins\//,            category: "Config plugin" },
  { pattern: /^modules\//,            category: "Native module" },
  { pattern: /^package\.json$/,       category: "Package deps" },
  { pattern: /\.(lock|lockb)$/,       category: "Lockfile" },
];

function getChangedFiles(): string[] {
  try {
    const out = execSync(`git diff --name-only ${base} ${head}`, {
      cwd: ROOT, encoding: "utf-8",
    }).trim();
    return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  } catch (e) {
    console.error("Error running git diff:", e);
    process.exit(1);
  }
}

function main(): void {
  const files = getChangedFiles();
  const native: Array<{ file: string; category: string }> = [];
  const js: string[] = [];

  for (const file of files) {
    const match = NATIVE_PATTERNS.find(({ pattern }) => pattern.test(file));
    if (match) {
      native.push({ file, category: match.category });
    } else {
      js.push(file);
    }
  }

  console.log(`\nDVNT Native Change Detector: ${base}..${head}\n`);
  console.log(`Total files changed: ${files.length}`);
  console.log(`  Native: ${native.length}`);
  console.log(`  JS/TS:  ${js.length}\n`);

  if (native.length > 0) {
    console.log("🔨 NATIVE changes (require new EAS build):");
    native.forEach(({ file, category }) => {
      console.log(`  [${category}] ${file}`);
    });
    console.log();
  }

  if (js.length > 0) {
    console.log("✅ JS/TS changes (OTA-eligible):");
    js.slice(0, 20).forEach((f) => console.log(`  ${f}`));
    if (js.length > 20) console.log(`  ... and ${js.length - 20} more`);
    console.log();
  }

  if (native.length > 0) {
    console.log("VERDICT: 🔨 NATIVE BUILD REQUIRED");
    process.exit(1);
  } else {
    console.log("VERDICT: ✅ OTA SAFE");
    process.exit(0);
  }
}

main();
