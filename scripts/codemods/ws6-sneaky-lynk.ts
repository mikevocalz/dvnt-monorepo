/**
 * WS-6 structure migration — PR 6 (sneaky-lynk merge), import codemod.
 *
 * sneaky-lynk was the last two-root split and the REFERENCE anatomy. Behavior-
 * preserving: the full canonical feature moved OUT of
 *   packages/app/src/sneaky-lynk/**   ->  packages/app/features/sneaky-lynk/**
 * merging into the web-screen half already living at
 * packages/app/features/sneaky-lynk/, and the 3 web screens were relocated into a
 * `screens/` subdir. Concretely, via `git mv`:
 *   src/sneaky-lynk/{api,components,errors.ts,hooks,mocks,rtc,stores,types,ui}
 *                                  -> features/sneaky-lynk/<same>   (merge)
 *   features/sneaky-lynk/{room,create,billing}.web.tsx
 *                                  -> features/sneaky-lynk/screens/<same>
 *   features/sneaky-lynk/{room-ui-store,create-store,billing-store}.ts
 *                                  -> features/sneaky-lynk/stores/<same>
 *
 * Every path under src/sneaky-lynk/ maps to the SAME relative path under
 * features/sneaky-lynk/, so the external alias rewrite is a single clean prefix
 * swap (RULE 1):
 *
 *   @dvnt/app/src/sneaky-lynk         ->  @dvnt/app/features/sneaky-lynk
 *   @dvnt/app/src/sneaky-lynk/<deep>  ->  @dvnt/app/features/sneaky-lynk/<deep>
 *
 * covering /api/supabase, /hooks/*, /ui, /ui/*, /stores/*, /types, /components/*,
 * /errors, etc.
 *
 * The 3 web screens changed depth (moved into screens/), so their alias importers
 * — the apps/web dynamic `import('@dvnt/app/features/sneaky-lynk/<screen>.web')`
 * pages — get an exact-match re-point (RULE 2):
 *
 *   @dvnt/app/features/sneaky-lynk/room.web    -> .../features/sneaky-lynk/screens/room.web
 *   @dvnt/app/features/sneaky-lynk/create.web  -> .../features/sneaky-lynk/screens/create.web
 *   @dvnt/app/features/sneaky-lynk/billing.web -> .../features/sneaky-lynk/screens/billing.web
 *
 * The 3 web screens imported their sibling UI stores via RELATIVE specifiers
 * (`./room-ui-store`, `./create-store`, `./billing-store`); those stores moved to
 * `stores/` and the screens moved to `screens/`, so the relative legs are
 * hand-fixed to `../stores/<store>` in the same PR (ts-morph string rules below
 * only touch the alias, so these relative stragglers are edited by hand).
 *
 * NOTE ON PRECISION: RULE 1 matches the FULL `@dvnt/app/src/sneaky-lynk` segment
 * only (exact, or followed by `/`); RULE 2 is exact-equality on the 3 screen
 * specifiers only — so no unrelated specifier is touched, and a re-run rewrites
 * nothing (the new paths already contain `/screens/`).
 *
 * ZERO logic edits — import/export module specifiers only, so the PR is
 * reviewable by diff shape alone. Re-runnable (idempotent).
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-sneaky-lynk.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// RULE 1 — src -> features prefix swap for the whole feature.
const PREFIX_RULES = [
  {
    oldExact: "@dvnt/app/src/sneaky-lynk",
    oldPrefix: "@dvnt/app/src/sneaky-lynk/",
    newExact: "@dvnt/app/features/sneaky-lynk",
    newPrefix: "@dvnt/app/features/sneaky-lynk/",
  },
];

// RULE 2 — the 3 web screens moved into screens/ (exact-match re-point).
const SCREEN_RULES: Record<string, string> = {
  "@dvnt/app/features/sneaky-lynk/room.web":
    "@dvnt/app/features/sneaky-lynk/screens/room.web",
  "@dvnt/app/features/sneaky-lynk/create.web":
    "@dvnt/app/features/sneaky-lynk/screens/create.web",
  "@dvnt/app/features/sneaky-lynk/billing.web":
    "@dvnt/app/features/sneaky-lynk/screens/billing.web",
};

function rewriteSpecifier(spec: string): string | null {
  // Screen exact-match takes priority (never applies to RULE-1 output, which is
  // never one of the 3 screen specifiers).
  if (SCREEN_RULES[spec]) return SCREEN_RULES[spec];
  for (const r of PREFIX_RULES) {
    if (spec === r.oldExact) return r.newExact;
    if (spec.startsWith(r.oldPrefix))
      return r.newPrefix + spec.slice(r.oldPrefix.length);
  }
  return null;
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});

const globs = [
  "packages/app/**/*.{ts,tsx}",
  "apps/web/src/**/*.{ts,tsx,js,jsx}",
  "apps/mobile/**/*.{ts,tsx,js,jsx}",
];
const ignore = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.expo/**",
  "**/.turbo/**",
  "**/dist/**",
  "**/build/**",
];

project.addSourceFilesAtPaths([
  ...globs.map((g) => path.join(REPO_ROOT, g)),
  ...ignore.map((g) => "!" + path.join(REPO_ROOT, g)),
]);

let filesChanged = 0;
let specifiersRewritten = 0;

for (const sourceFile of project.getSourceFiles()) {
  let touched = false;

  // Static import + export (re-export) declarations.
  const decls = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ];
  for (const decl of decls) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec) continue;
    const next = rewriteSpecifier(spec);
    if (next) {
      decl.setModuleSpecifier(next);
      specifiersRewritten++;
      touched = true;
    }
  }

  // Dynamic import(...) / require(...) string literals (the apps/web pages use
  // dynamic import() for the web screens).
  for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const call = lit.getParentIfKind(SyntaxKind.CallExpression);
    if (!call) continue;
    const callee = call.getExpression().getText();
    if (callee !== "require" && callee !== "import") continue;
    const next = rewriteSpecifier(lit.getLiteralValue());
    if (next) {
      lit.setLiteralValue(next);
      specifiersRewritten++;
      touched = true;
    }
  }

  if (touched) {
    filesChanged++;
    console.log("  rewrote", path.relative(REPO_ROOT, sourceFile.getFilePath()));
  }
}

project.saveSync();

console.log(
  `\nws6-sneaky-lynk codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
