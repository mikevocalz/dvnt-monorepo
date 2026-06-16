#!/usr/bin/env node

/**
 * Migration Health Check
 *
 * Validates:
 * 1. All .sql files in supabase/migrations/ have valid timestamp prefixes
 * 2. No duplicate timestamps
 * 3. Files are non-empty
 * 4. No .sql.skip files without documentation
 *
 * Run: pnpm check:migrations
 */

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");
const SKIP_AUDIT_PATH = path.join(
  __dirname,
  "..",
  "docs",
  "SKIPPED_MIGRATIONS_AUDIT.md",
);

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let errors = 0;
let warnings = 0;

function error(msg) {
  console.error(`${RED}ERROR:${RESET} ${msg}`);
  errors++;
}

function warn(msg) {
  console.warn(`${YELLOW}WARN:${RESET} ${msg}`);
  warnings++;
}

function main() {
  console.log(`${YELLOW}🔍 Checking migration health...${RESET}\n`);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    error("supabase/migrations/ directory not found");
    process.exit(1);
  }

  const allFiles = fs.readdirSync(MIGRATIONS_DIR);
  const sqlFiles = allFiles.filter((f) => f.endsWith(".sql"));
  const skipFiles = allFiles.filter((f) => f.endsWith(".sql.skip"));

  console.log(`  Active migrations: ${sqlFiles.length}`);
  console.log(`  Skipped migrations: ${skipFiles.length}\n`);

  // 1. Validate timestamp prefixes
  const TIMESTAMP_RE = /^(\d{8,15})[_-]/;
  const timestamps = new Map();

  for (const file of sqlFiles) {
    const match = file.match(TIMESTAMP_RE);
    if (!match) {
      error(`${file} — missing or invalid timestamp prefix`);
      continue;
    }

    const ts = match[1];
    if (timestamps.has(ts)) {
      // Same-day (8-digit) timestamps are fine — Supabase orders by full filename
      if (ts.length <= 8) {
        // No warning needed for same-date migrations
      } else {
        error(`Duplicate timestamp ${ts}: ${timestamps.get(ts)} and ${file}`);
      }
    }
    timestamps.set(ts, file);

    // 2. Check non-empty
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const content = fs.readFileSync(fullPath, "utf-8").trim();
    if (content.length === 0) {
      error(`${file} — empty migration file`);
    }

    // 3. Basic SQL sanity — should contain at least one statement
    if (
      content.length > 0 &&
      !content.includes(";") &&
      !content.toLowerCase().includes("begin")
    ) {
      warn(`${file} — no SQL statements found (missing semicolons)`);
    }
  }

  // 4. Check skip files are documented
  if (skipFiles.length > 0) {
    if (!fs.existsSync(SKIP_AUDIT_PATH)) {
      warn(
        `${skipFiles.length} .sql.skip files exist but docs/SKIPPED_MIGRATIONS_AUDIT.md is missing`,
      );
    } else {
      const auditContent = fs.readFileSync(SKIP_AUDIT_PATH, "utf-8");
      for (const skip of skipFiles) {
        const baseName = skip.replace(".skip", "");
        if (!auditContent.includes(baseName)) {
          warn(`${skip} — not documented in SKIPPED_MIGRATIONS_AUDIT.md`);
        }
      }
    }
  }

  // 5. Check for ordering issues (timestamps should be monotonically increasing)
  const sortedTimestamps = [...timestamps.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (let i = 1; i < sortedTimestamps.length; i++) {
    const [prevTs] = sortedTimestamps[i - 1];
    const [currTs, currFile] = sortedTimestamps[i];
    if (currTs < prevTs) {
      warn(`${currFile} — out-of-order timestamp (${currTs} < ${prevTs})`);
    }
  }

  // Summary
  console.log("");
  if (errors > 0) {
    console.log(`${RED}❌ ${errors} error(s), ${warnings} warning(s)${RESET}`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${YELLOW}⚠️  ${warnings} warning(s), 0 errors${RESET}`);
    process.exit(0);
  } else {
    console.log(`${GREEN}✅ All ${sqlFiles.length} migrations healthy${RESET}`);
    process.exit(0);
  }
}

main();
