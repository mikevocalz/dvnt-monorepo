/**
 * Pre-OTA env var validation script
 *
 * Run before `eas update` to catch unresolved ${VAR} literals in eas.json
 * that would be inlined verbatim into the Metro bundle.
 *
 * Background: eas.json `env` section uses EAS Secrets syntax (${VAR}) that
 * EAS resolves during native builds on EAS servers. For local `eas update`
 * runs, EAS CLI passes these values verbatim to Metro — unresolved refs
 * land in the bundle as truthy strings, bypassing || fallbacks.
 *
 * This script reads eas.json, checks all EXPO_PUBLIC_* values for:
 *   1. Unresolved ${...} references (would break at runtime)
 *   2. Empty strings (|| fallback fires but you may not want that)
 *   3. Critical URL fields that must start with https://
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const EAS_JSON = path.join(ROOT, "eas.json");

/**
 * Vars that MUST be real https:// URLs in eas.json.
 * If unresolved, they cause iOS to resolve the schemeless string relative
 * to the app bundle → file:///... and every network request fails silently.
 */
const MUST_BE_HTTPS_VARS = ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_AUTH_URL"];

interface EnvChecks {
  errors: string[];
  warnings: string[];
}

function checkEnvSection(env: Record<string, string>): EnvChecks {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("EXPO_PUBLIC_")) continue;

    const isUnresolved = typeof value === "string" && /\$\{[^}]+\}/.test(value);

    if (MUST_BE_HTTPS_VARS.includes(key)) {
      if (isUnresolved) {
        errors.push(
          `  ❌ ${key} = "${value}"  ← unresolved ref, will break uploads/auth`,
        );
      } else if (typeof value === "string" && !value.startsWith("https://")) {
        errors.push(`  ❌ ${key} = "${value}"  ← must start with https://`);
      }
    } else if (isUnresolved) {
      warnings.push(
        `  ⚠️  ${key} = "${value}"  ← unresolved (verify .env has this)`,
      );
    }
  }

  return { errors, warnings };
}

function main() {
  if (!fs.existsSync(EAS_JSON)) {
    console.error("❌ eas.json not found at", EAS_JSON);
    process.exit(1);
  }

  const eas = JSON.parse(fs.readFileSync(EAS_JSON, "utf8"));
  const profiles = eas?.build ?? {};

  let totalErrors = 0;
  let totalWarnings = 0;

  console.log("\n🔍 Checking eas.json env sections for OTA compatibility...\n");

  for (const [profile, config] of Object.entries(profiles) as [
    string,
    { env?: Record<string, string> },
  ][]) {
    const env = config?.env ?? {};
    const { errors, warnings } = checkEnvSection(env);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`✅ [${profile}] Critical EXPO_PUBLIC_* vars OK`);
      continue;
    }

    console.log(`📋 [${profile}]`);

    if (errors.length > 0) {
      errors.forEach((l: string) => console.log(l));
      totalErrors += errors.length;
    }

    if (warnings.length > 0) {
      warnings.forEach((l: string) => console.log(l));
      totalWarnings += warnings.length;
    }

    console.log("");
  }

  console.log("─".repeat(60));

  if (totalErrors > 0) {
    console.log(
      `\n❌ BLOCKED: ${totalErrors} error(s) found. Fix before running eas update.\n`,
    );
    console.log("How to fix unresolved refs:");
    console.log(
      "  • Hardcode non-secret EXPO_PUBLIC_* values directly in eas.json",
    );
    console.log(
      "  • OR export the variable in your shell: export EXPO_PUBLIC_SUPABASE_URL=...",
    );
    console.log(
      "  • OR ensure the code has startsWith('https://') guard with hardcoded fallback\n",
    );
    process.exit(1);
  }

  if (totalWarnings > 0) {
    console.log(
      `\n⚠️  ${totalWarnings} warning(s) — || fallbacks will fire for empty values`,
    );
  }

  console.log("\n✅ All checks passed. Safe to run eas update.\n");
}

main();
