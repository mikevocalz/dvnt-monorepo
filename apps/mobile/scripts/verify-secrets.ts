/**
 * Supabase Secrets Verification Guard
 *
 * Validates that critical Supabase secrets match expected fingerprints
 * BEFORE deploying edge functions. Prevents accidental credential rotation
 * from breaking production.
 *
 * Usage: npx tsx scripts/verify-secrets.ts
 *
 * This script:
 * 1. Deploys a tiny probe function that reads env vars
 * 2. Calls it to get fingerprints (first8 + last4 + length)
 * 3. Compares against known-good values
 * 4. Cleans up the probe function
 * 5. Exits non-zero if any mismatch
 */

import { execSync } from "child_process";

const PROJECT_REF = "npfjanxturvmjyevoyfo";

// ── Known-good secret fingerprints ──
// These are NOT the secrets themselves — just first8 + last4 + length
// Update these ONLY when you intentionally rotate credentials
const EXPECTED = {
  FISHJAM_APP_ID: { first8: "e921bfe8", last4: "c6f0", length: 32 },
  FISHJAM_API_KEY: { first8: "864e60f2", last4: "7090", length: 64 },
};

function run(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    return e.stdout?.toString().trim() || e.message;
  }
}

async function main() {
  console.log("🔐 Verifying Supabase secrets...\n");

  // Write a minimal probe function
  const probeCode = `
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
serve(async () => {
  const secrets: Record<string, any> = {};
  for (const key of ${JSON.stringify(Object.keys(EXPECTED))}) {
    const val = Deno.env.get(key) || "";
    secrets[key] = {
      first8: val.slice(0, 8),
      last4: val.slice(-4),
      length: val.length,
      set: val.length > 0,
    };
  }
  return new Response(JSON.stringify(secrets), {
    headers: { "Content-Type": "application/json" },
  });
});
`.trim();

  const fs = await import("fs");
  const path = await import("path");
  const probeDir = path.join(
    __dirname,
    "..",
    "supabase",
    "functions",
    "_probe_secrets",
  );
  const probePath = path.join(probeDir, "index.ts");

  // Create probe function
  fs.mkdirSync(probeDir, { recursive: true });
  fs.writeFileSync(probePath, probeCode);

  try {
    // Deploy probe
    console.log("  Deploying probe function...");
    const deployOut = run(
      `npx supabase functions deploy _probe_secrets --no-verify-jwt --project-ref ${PROJECT_REF}`,
    );
    if (deployOut.includes("Error") && !deployOut.includes("Deployed")) {
      console.error("  ❌ Failed to deploy probe:", deployOut);
      process.exit(1);
    }

    // Wait for cold start
    await new Promise((r) => setTimeout(r, 2000));

    // Call probe
    console.log("  Calling probe function...");
    const response = run(
      `curl -s "https://${PROJECT_REF}.supabase.co/functions/v1/_probe_secrets"`,
    );

    let secrets: Record<string, any>;
    try {
      secrets = JSON.parse(response);
    } catch {
      console.error(
        "  ❌ Probe returned invalid JSON:",
        response.slice(0, 200),
      );
      process.exit(1);
    }

    // Verify each secret
    let hasErrors = false;
    for (const [key, expected] of Object.entries(EXPECTED)) {
      const actual = secrets[key];
      if (!actual || !actual.set) {
        console.error(`  ❌ ${key}: NOT SET`);
        hasErrors = true;
        continue;
      }

      const matches =
        actual.first8 === expected.first8 &&
        actual.last4 === expected.last4 &&
        actual.length === expected.length;

      if (matches) {
        console.log(
          `  ✅ ${key}: ${actual.first8}...${actual.last4} (${actual.length} chars)`,
        );
      } else {
        console.error(
          `  ❌ ${key}: MISMATCH!\n` +
            `     Got:      ${actual.first8}...${actual.last4} (${actual.length} chars)\n` +
            `     Expected: ${expected.first8}...${expected.last4} (${expected.length} chars)`,
        );
        hasErrors = true;
      }
    }

    if (hasErrors) {
      console.error(
        "\n💥 SECRET MISMATCH DETECTED!\n" +
          "Someone changed the Fishjam credentials in Supabase secrets.\n" +
          "If this was intentional, update EXPECTED in scripts/verify-secrets.ts.\n" +
          "If NOT, restore them with:\n\n" +
          `  npx supabase secrets set "FISHJAM_APP_ID=<correct_value>" "FISHJAM_API_KEY=<correct_value>" --project-ref ${PROJECT_REF}\n`,
      );
      process.exit(1);
    }

    console.log("\n✅ All secrets verified.");
  } finally {
    // Cleanup probe function
    console.log("\n  Cleaning up probe function...");
    run(
      `npx supabase functions delete _probe_secrets --project-ref ${PROJECT_REF}`,
    );
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
