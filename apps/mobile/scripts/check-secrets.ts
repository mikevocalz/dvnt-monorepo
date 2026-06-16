#!/usr/bin/env npx ts-node

/**
 * Security & Architecture Guardrails
 *
 * This script scans the codebase to ensure:
 * 1. EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is never used
 * 2. SUPABASE_SERVICE_ROLE_KEY is not in client code
 * 3. No direct writes to sensitive tables from client code
 * 4. No parseInt on Better Auth IDs
 * 5. No getCurrentUserIdInt usage for Better Auth IDs
 *
 * Run: npm run check:guardrails
 * Should be run in CI and pre-commit hooks.
 */

import * as fs from "fs";
import * as path from "path";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

// Sensitive tables that should not have direct client writes
const SENSITIVE_TABLES = [
  "users",
  "posts",
  "stories",
  "events",
  "messages",
  "conversations",
  "conversation_members",
  "follows",
  "likes",
  "comments",
  "blocks",
];

// Patterns that should NEVER appear in client code
const FORBIDDEN_PATTERNS = [
  {
    pattern: /EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/g,
    message:
      "EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY should NEVER be used. Service role key must not be exposed to client.",
    severity: "critical",
  },
  {
    pattern: /SUPABASE_SERVICE_ROLE_KEY/g,
    message:
      "SUPABASE_SERVICE_ROLE_KEY found in client code. This key should only be used in Edge Functions.",
    allowedPaths: ["/supabase/functions/", "/scripts/"],
    severity: "critical",
  },
  {
    pattern: /supabaseAdmin/g,
    message:
      "supabaseAdmin should not exist in client code. Use Edge Functions for privileged operations.",
    allowedPaths: ["/supabase/functions/"],
    severity: "critical",
  },
  {
    pattern: /parseInt\s*\(\s*session\.user\.id/g,
    message:
      "Never parseInt Better Auth session.user.id - it's a string, not an integer!",
    severity: "error",
  },
  {
    pattern: /getCurrentUserIdInt\s*\(/g,
    message:
      "getCurrentUserIdInt is deprecated. Use getCurrentUserId() from lib/auth/identity.ts instead.",
    allowedPaths: ["/lib/api/auth-helper.ts"], // Allow in the definition file
    severity: "warning",
  },
  {
    pattern: /eyJhbGciOi[A-Za-z0-9_-]{20,}/g,
    message:
      "Hardcoded JWT/API key detected! Keys must come from environment variables, NEVER hardcoded in source.",
    allowedPaths: ["/scripts/check-secrets.ts"],
    severity: "critical",
  },
  {
    pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4,}[0-9a-f-]{8,}/g,
    message:
      "Possible hardcoded API key (UUID-like secret). Keys must come from environment variables.",
    allowedPaths: [
      "/scripts/check-secrets.ts",
      "/supabase/functions/",
      "/.env",
      "/app.config.js",
      "/eas.json",
      "/public/.well-known/",
    ],
    severity: "warning",
  },
];

// Directories to scan (relative to project root)
const SCAN_DIRS = ["app", "src", "lib", "components", "packages"];

// File extensions to check
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// Files/dirs to skip
const SKIP_PATTERNS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  ".next",
  "check-secrets.ts", // Don't flag this file
];

interface Violation {
  file: string;
  line: number;
  pattern: string;
  message: string;
}

function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((skip) => filePath.includes(skip));
}

function isAllowedPath(filePath: string, allowedPaths?: string[]): boolean {
  if (!allowedPaths) return false;
  return allowedPaths.some((allowed) => filePath.includes(allowed));
}

function scanFile(filePath: string): Violation[] {
  const violations: Violation[] = [];

  if (shouldSkip(filePath)) return violations;

  const ext = path.extname(filePath);
  if (!EXTENSIONS.includes(ext)) return violations;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Check forbidden patterns
    for (const { pattern, message, allowedPaths } of FORBIDDEN_PATTERNS) {
      if (isAllowedPath(filePath, allowedPaths)) continue;

      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          violations.push({
            file: filePath,
            line: index + 1,
            pattern: pattern.source,
            message,
          });
        }
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
      });
    }

    // Check for direct writes to sensitive tables
    // Only check client code (not Edge Functions or scripts)
    if (
      !filePath.includes("/supabase/functions/") &&
      !filePath.includes("/scripts/")
    ) {
      for (const table of SENSITIVE_TABLES) {
        const writePatterns = [
          new RegExp(
            `\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\s*\\)\\s*\\.\\s*insert`,
            "g",
          ),
          new RegExp(
            `\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\s*\\)\\s*\\.\\s*update`,
            "g",
          ),
          new RegExp(
            `\\.from\\s*\\(\\s*["'\`]${table}["'\`]\\s*\\)\\s*\\.\\s*delete`,
            "g",
          ),
          new RegExp(
            `\\.from\\s*\\(\\s*DB\\.\\w+\\.table\\s*\\)\\s*\\.\\s*insert`,
            "g",
          ),
          new RegExp(
            `\\.from\\s*\\(\\s*DB\\.\\w+\\.table\\s*\\)\\s*\\.\\s*update`,
            "g",
          ),
          new RegExp(
            `\\.from\\s*\\(\\s*DB\\.\\w+\\.table\\s*\\)\\s*\\.\\s*delete`,
            "g",
          ),
        ];

        lines.forEach((line, index) => {
          for (const writePattern of writePatterns) {
            if (writePattern.test(line)) {
              violations.push({
                file: filePath,
                line: index + 1,
                pattern: `direct write to ${table}`,
                message: `Direct write to "${table}" table detected. Use Edge Function wrappers from lib/api/privileged/index.ts instead.`,
              });
            }
            writePattern.lastIndex = 0;
          }
        });
      }
    }
  } catch (error) {
    // Skip files that can't be read
  }

  return violations;
}

function scanDirectory(dir: string): Violation[] {
  const violations: Violation[] = [];

  if (!fs.existsSync(dir)) return violations;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (shouldSkip(fullPath)) continue;

    if (entry.isDirectory()) {
      violations.push(...scanDirectory(fullPath));
    } else if (entry.isFile()) {
      violations.push(...scanFile(fullPath));
    }
  }

  return violations;
}

function main(): void {
  console.log(`${YELLOW}🔍 Scanning for security violations...${RESET}\n`);

  const projectRoot = process.cwd();
  let allViolations: Violation[] = [];

  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(projectRoot, dir);
    const violations = scanDirectory(fullPath);
    allViolations.push(...violations);
  }

  // Also check root-level config files
  const rootFiles = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    "eas.json",
  ];
  for (const file of rootFiles) {
    const fullPath = path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      allViolations.push(...scanFile(fullPath));
    }
  }

  if (allViolations.length === 0) {
    console.log(`${GREEN}✅ No security violations found!${RESET}\n`);
    console.log(
      "Service role key is properly isolated to Edge Functions only.",
    );
    process.exit(0);
  }

  console.log(
    `${RED}❌ Found ${allViolations.length} security violation(s):${RESET}\n`,
  );

  for (const violation of allViolations) {
    console.log(`${RED}VIOLATION:${RESET} ${violation.file}:${violation.line}`);
    console.log(`  Pattern: ${violation.pattern}`);
    console.log(`  ${violation.message}\n`);
  }

  console.log(`${YELLOW}Fix these issues before committing.${RESET}`);
  console.log(
    "Service role key must ONLY be used in Supabase Edge Functions.\n",
  );

  process.exit(1);
}

main();
