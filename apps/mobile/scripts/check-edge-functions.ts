/**
 * Edge Function Regression Guard
 *
 * Validates ALL edge functions follow the correct Better Auth session pattern
 * and have no broken variable references. Run before every deploy.
 *
 * Usage: npx tsx scripts/check-edge-functions.ts
 */

import * as fs from "fs";
import * as path from "path";

const FUNCTIONS_DIR = path.join(__dirname, "..", "supabase", "functions");

// Functions that DON'T use Better Auth session (exempt from checks)
const EXEMPT_FUNCTIONS = new Set([
  "auth", // IS the auth server
  "cleanup-expired-media", // Cron job, no auth
  "create-test-user", // Dev-only
  "send_notification", // Internal trigger
  "media-upload", // Uses different auth
]);

interface CheckResult {
  fn: string;
  errors: string[];
  warnings: string[];
}

function checkFunction(fnDir: string): CheckResult {
  const fnName = path.basename(fnDir);
  const indexPath = path.join(fnDir, "index.ts");
  const result: CheckResult = { fn: fnName, errors: [], warnings: [] };

  if (!fs.existsSync(indexPath)) {
    result.warnings.push("No index.ts found");
    return result;
  }

  const code = fs.readFileSync(indexPath, "utf-8");

  if (EXEMPT_FUNCTIONS.has(fnName)) {
    return result;
  }

  // ── CRITICAL: Check for correct createClient pattern ──
  if (code.includes("createClient(")) {
    if (!code.includes("persistSession: false")) {
      result.errors.push(
        "createClient missing { auth: { persistSession: false } } — RLS will block queries",
      );
    }
    const hasAuthHeader = /Authorization:\s*`Bearer \$\{[A-Za-z_]+\}`/.test(
      code,
    );
    if (!hasAuthHeader) {
      result.errors.push(
        "createClient missing global.headers.Authorization — service role won't work",
      );
    }
  }

  // ── CRITICAL: Check for session verification pattern ──
  const usesVerifySession =
    code.includes("verifySession(") || code.includes("verifyBetterAuthSession");
  const queriesSessionSelect = /\.from\("session"\)\s*\n?\s*\.select\(/.test(
    code,
  );
  const queriesSessionDeleteOnly =
    code.includes('from("session")') && !queriesSessionSelect;

  if (queriesSessionSelect) {
    // Good — uses direct DB lookup. Accept both `sessionData.userId` and `session.userId`
    if (
      !code.includes("sessionData.userId") &&
      !code.includes("session.userId") &&
      !code.includes("session?.userId")
    ) {
      result.errors.push(
        "Queries session table but never reads userId from result",
      );
    }
  } else if (usesVerifySession) {
    // Good — delegates to shared verifySession helper
  } else if (queriesSessionDeleteOnly) {
    // Deleting sessions (e.g. account deletion) — not a verification query
  } else if (code.includes("Authorization")) {
    result.warnings.push(
      "No session verification found (no session table query or verifyBetterAuthSession)",
    );
  }

  // ── CRITICAL: Check for broken variable references ──
  // Pattern: using a variable that was destructured from an undefined object
  const undefinedSessionPattern = /const\s*\{[^}]*\}\s*=\s*session\s*;/;
  if (undefinedSessionPattern.test(code)) {
    result.errors.push(
      "BROKEN: Destructuring from undefined `session` variable (old pattern leftover)",
    );
  }

  // Check for using `authId` without declaring it (common copy-paste bug)
  const usesAuthId =
    code.includes('.eq("auth_id", authId)') ||
    code.includes('.eq("auth_id", authId)');
  const declaresAuthId =
    code.includes("const authId") ||
    code.includes("let authId") ||
    code.includes("authId =");
  if (usesAuthId && !declaresAuthId) {
    result.errors.push(
      "Uses `authId` variable but never declares it — will throw ReferenceError",
    );
  }

  // ── FORBIDDEN: Never query Better Auth "user" table separately ──
  if (code.includes('.from("user")') && !fnName.includes("auth-sync")) {
    result.warnings.push(
      'Queries Better Auth "user" table — unnecessary hop, use session.userId directly',
    );
  }

  // ── Check for correct error response pattern ──
  if (
    code.includes("errorResponse(") &&
    code.includes("function errorResponse")
  ) {
    // Count params in function signature
    const sigMatch = code.match(/function errorResponse\(([^)]*)\)/);
    if (sigMatch) {
      const params = sigMatch[1].split(",").length;
      // Check if called with more args than declared
      const callMatches = code.matchAll(/errorResponse\(([^)]*)\)/g);
      for (const call of callMatches) {
        if (call[1].includes("function")) continue; // skip the declaration
        const callArgs = call[1].split(",").length;
        if (callArgs > params) {
          result.warnings.push(
            `errorResponse called with ${callArgs} args but only accepts ${params}`,
          );
          break;
        }
      }
    }
  }

  // ── Check for hardcoded secrets ──
  if (/eyJhbGci/.test(code)) {
    result.errors.push("SECURITY: Hardcoded JWT found in source");
  }
  if (
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(code)
  ) {
    // Allow UUIDs that are clearly not secrets (e.g. in comments)
    const uuidMatches = code.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    );
    if (uuidMatches && uuidMatches.length > 0) {
      // Only warn if UUID appears outside of comments
      for (const uuid of uuidMatches) {
        const idx = code.indexOf(uuid);
        const lineStart = code.lastIndexOf("\n", idx);
        const line = code.slice(lineStart, idx);
        if (!line.includes("//") && !line.includes("*")) {
          result.warnings.push(
            "Possible hardcoded UUID found — verify it's not a secret",
          );
          break;
        }
      }
    }
  }

  return result;
}

// ── Main ──
const dirs = fs
  .readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(FUNCTIONS_DIR, d.name));

let hasErrors = false;
let totalErrors = 0;
let totalWarnings = 0;

console.log("🔍 Checking edge functions...\n");

for (const dir of dirs) {
  const result = checkFunction(dir);

  if (result.errors.length === 0 && result.warnings.length === 0) {
    console.log(`  ✅ ${result.fn}`);
    continue;
  }

  if (result.errors.length > 0) {
    hasErrors = true;
    totalErrors += result.errors.length;
    console.log(`  ❌ ${result.fn}`);
    for (const err of result.errors) {
      console.log(`     ERROR: ${err}`);
    }
  } else {
    console.log(`  ⚠️  ${result.fn}`);
  }

  totalWarnings += result.warnings.length;
  for (const warn of result.warnings) {
    console.log(`     WARN: ${warn}`);
  }
}

console.log(
  `\n📊 Results: ${dirs.length} functions, ${totalErrors} errors, ${totalWarnings} warnings`,
);

if (hasErrors) {
  console.log("\n💥 FAILED — Fix errors before deploying!");
  process.exit(1);
} else {
  console.log("\n✅ All edge functions pass validation.");
  process.exit(0);
}
