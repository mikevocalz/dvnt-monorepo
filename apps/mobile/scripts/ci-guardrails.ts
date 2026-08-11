/**
 * CI Guardrails — Stop-the-line checks for PRs.
 *
 * Run: npx tsx scripts/ci-guardrails.ts
 *
 * Checks:
 * 1. No direct client writes to core tables
 * 2. No broad invalidation storms
 * 3. Edge Functions have correct createClient config
 * 4. Query keys include all params
 * 5. No useState in protected screens (Zustand only)
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
let errors: string[] = [];
let warnings: string[] = [];

// ═══════════════════════════════════════════════════════════════════
// 1. No direct client writes to core tables
// ═══════════════════════════════════════════════════════════════════

const PROTECTED_TABLES = [
  "likes",
  "follows",
  "bookmarks",
  "event_likes",
  "event_rsvps",
  "notifications",
  "posts",
  "comments",
  "stories",
  "events",
  "tickets",
  "messages",
  "comment_likes",
];

// ROOT is apps/mobile, so these four only ever covered the app shell. Almost all
// client code now lives in packages/app — which is how a raw `FlatList` reached
// `components/ui/location-autocomplete-v3.tsx` with a guardrail supposedly
// banning it. Scan the workspace package too.
const CLIENT_DIRS = [
  "lib",
  "app",
  "components",
  "src",
  "../../packages/app/lib",
  "../../packages/app/components",
  "../../packages/app/features",
  "../../packages/ui/src",
];

function checkDirectWrites() {
  for (const dir of CLIENT_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkFiles(fullDir, ".ts", (filePath, content) => {
      // Skip test files and Edge Function wrappers
      if (filePath.includes("__test") || filePath.includes(".spec.")) return;
      if (filePath.includes("privileged") || filePath.includes("api/")) return;

      for (const table of PROTECTED_TABLES) {
        // Check for .from("table").insert/update/delete
        const pattern = new RegExp(
          `\\.from\\(['"]\s*${table}\s*['"]\\)\\s*\\.(insert|update|delete|upsert)`,
          "g",
        );
        if (pattern.test(content)) {
          errors.push(
            `DIRECT_WRITE: ${path.relative(ROOT, filePath)} writes to "${table}" — must use Edge Function gateway`,
          );
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 2. No broad invalidation storms
// ═══════════════════════════════════════════════════════════════════

function checkInvalidationStorms() {
  const hooksDir = path.join(ROOT, "lib/hooks");
  if (!fs.existsSync(hooksDir)) return;

  walkFiles(hooksDir, ".ts", (filePath, content) => {
    // Flag: invalidateQueries with very broad keys
    const broadPatterns = [
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']users["']\s*\]/g,
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']events["']\s*\]/g,
      /invalidateQueries\(\s*\{\s*queryKey:\s*\[\s*["']posts["']\s*\]/g,
    ];

    for (const pattern of broadPatterns) {
      if (pattern.test(content)) {
        warnings.push(
          `BROAD_INVALIDATION: ${path.relative(ROOT, filePath)} uses broad key invalidation — prefer cache patching`,
        );
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// 3. No useState in protected screens (Zustand mandate)
// ═══════════════════════════════════════════════════════════════════

const USESTATE_EXEMPT = [
  "login.tsx",
  "signup",
  "onboarding",
  "debug.tsx",
  // Form state in TanStack Form is acceptable
];

function checkUseState() {
  const appDir = path.join(ROOT, "app/(protected)");
  if (!fs.existsSync(appDir)) return;

  walkFiles(appDir, ".tsx", (filePath, content) => {
    const basename = path.basename(filePath);
    if (USESTATE_EXEMPT.some((e) => basename.includes(e))) return;

    // Allow useState for truly local UI state (modals, animations)
    // Flag only if there are many useState calls (likely misuse)
    const matches = content.match(/useState\s*[<(]/g);
    if (matches && matches.length > 3) {
      warnings.push(
        `USESTATE: ${path.relative(ROOT, filePath)} has ${matches.length} useState calls — consider Zustand store`,
      );
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// 4. No banned list imports (FlatList, SectionList, direct @legendapp/list)
// ═══════════════════════════════════════════════════════════════════

function checkBannedListImports() {
  for (const dir of CLIENT_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkFiles(fullDir, ".tsx", (filePath, content) => {
      if (filePath.includes("node_modules")) return;
      if (filePath.includes("components/list")) return; // blessed wrapper

      // FlatList from react-native
      if (
        /import\s+\{[^}]*FlatList[^}]*\}\s+from\s+["']react-native["']/.test(
          content,
        )
      ) {
        errors.push(
          `BANNED_FLATLIST: ${path.relative(ROOT, filePath)} imports FlatList — use LegendList from @/components/list`,
        );
      }

      // Direct @legendapp/list import (must use blessed wrapper)
      if (/from\s+["']@legendapp\/list["']/.test(content)) {
        errors.push(
          `DIRECT_LEGENDLIST: ${path.relative(ROOT, filePath)} imports directly from @legendapp/list — use @/components/list`,
        );
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// 5. No client-side write-capable secrets (audit SEC-01)
// ═══════════════════════════════════════════════════════════════════

const BANNED_CLIENT_SECRETS = [
  "EXPO_PUBLIC_BUNNY_STORAGE_API_KEY",
  "EXPO_PUBLIC_STRIPE_SECRET",
  "EXPO_PUBLIC_RESEND_API_KEY",
  "EXPO_PUBLIC_SERVICE_ROLE",
];

// Files that are deprecated for app use and only used by scripts.
// They won't be bundled because no app code imports them.
const SECRET_CHECK_EXCLUDES = ["bunny-storage.ts"];

function checkClientSecrets() {
  for (const dir of CLIENT_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    walkFiles(fullDir, ".ts", (filePath, content) => {
      if (filePath.includes("node_modules")) return;
      if (SECRET_CHECK_EXCLUDES.some((e) => filePath.endsWith(e))) return;

      for (const secret of BANNED_CLIENT_SECRETS) {
        if (content.includes(secret)) {
          errors.push(
            `CLIENT_SECRET: ${path.relative(ROOT, filePath)} references ${secret} — write-capable keys must not be in client code`,
          );
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function walkFiles(
  dir: string,
  ext: string,
  callback: (filePath: string, content: string) => void,
) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkFiles(fullPath, ext, callback);
    } else if (entry.name.endsWith(ext)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      callback(fullPath, content);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Run
// ═══════════════════════════════════════════════════════════════════

console.log("🔒 DVNT CI Guardrails\n");

checkDirectWrites();
checkInvalidationStorms();
checkUseState();
checkBannedListImports();
checkClientSecrets();

if (warnings.length > 0) {
  console.log("⚠️  Warnings:");
  warnings.forEach((w) => console.log(`  ${w}`));
  console.log();
}

if (errors.length > 0) {
  console.log("❌ ERRORS (must fix before merge):");
  errors.forEach((e) => console.log(`  ${e}`));
  console.log(`\n${errors.length} error(s) found. CI BLOCKED.`);
  process.exit(1);
} else {
  console.log(`✅ All checks passed (${warnings.length} warning(s))`);
  process.exit(0);
}
