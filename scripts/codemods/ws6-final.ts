/**
 * WS-6 structure migration — FINAL PR (empty the last of `packages/app/src/`),
 * import codemod.
 *
 * Behavior-preserving: the last 6 files under `packages/app/src/` were relocated
 * out of the dead `src/` root via `git mv` (ZERO logic edits). Their own imports
 * are unchanged by the move — each moved unit reaches the rest of the package via
 * the `@dvnt/app/*` alias (never via `../` out of `src/`), and `components/map/`
 * moved as a whole subtree so its internal `./DvntMap` relative import still
 * resolves. This codemod only rewrites the EXTERNAL specifiers consumers use to
 * reach the moved files:
 *
 *   @dvnt/app/src/components/map          ->  @dvnt/app/components/map
 *   @dvnt/app/src/components/map/<deep>   ->  @dvnt/app/components/map/<deep>
 *   @dvnt/app/src/components/sheets       ->  @dvnt/app/components/sheets
 *   @dvnt/app/src/components/sheets/<d>   ->  @dvnt/app/components/sheets/<d>
 *   @dvnt/app/src/constants/mentions      ->  @dvnt/app/lib/constants/mentions
 *   @dvnt/app/src/routing/deeplinks       ->  @dvnt/app/lib/deep-linking/deeplinks
 *
 * New homes (reported in the PR):
 *   - components/{map,sheets}  : app-global component location (packages/ui
 *                                promotion is a later, logic-bearing sweep — §5).
 *   - lib/constants/mentions   : `lib/constants/` already houses app-global
 *                                constants (event-categories, identity, sheets…).
 *   - lib/deep-linking/deeplinks: colocated with the existing `deep-linking/`
 *                                dir (link-engine, route-registry, share-link).
 *
 * NOTE ON PRECISION: rules match the FULL path segment only (exact, or followed
 * by `/`), so e.g. `@dvnt/app/src/constants/mentions` is rewritten but a
 * hypothetical `@dvnt/app/src/constants/mentionsomething` would not be. `sheets`
 * as an exact specifier and `sheets/AppSheet` as a deep specifier are both
 * handled by the prefix rule.
 *
 * ZERO logic edits — import/export/dynamic-import module specifiers only, so the
 * PR is reviewable by diff shape alone. Re-runnable (idempotent): once the old
 * `@dvnt/app/src/*` paths are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-final.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Ordered EXACT/PREFIX rewrite rules. Each moved unit gets an exact rule (bare
 * specifier) and a prefix rule (deep import). Longest/most-specific old paths
 * first so `src/components/map` is tried before any shorter overlap.
 */
const RULES: ReadonlyArray<{
  oldExact: string;
  oldPrefix: string;
  newExact: string;
  newPrefix: string;
}> = [
  {
    oldExact: "@dvnt/app/src/components/map",
    oldPrefix: "@dvnt/app/src/components/map/",
    newExact: "@dvnt/app/components/map",
    newPrefix: "@dvnt/app/components/map/",
  },
  {
    oldExact: "@dvnt/app/src/components/sheets",
    oldPrefix: "@dvnt/app/src/components/sheets/",
    newExact: "@dvnt/app/components/sheets",
    newPrefix: "@dvnt/app/components/sheets/",
  },
  {
    oldExact: "@dvnt/app/src/constants/mentions",
    oldPrefix: "@dvnt/app/src/constants/mentions/",
    newExact: "@dvnt/app/lib/constants/mentions",
    newPrefix: "@dvnt/app/lib/constants/mentions/",
  },
  {
    oldExact: "@dvnt/app/src/routing/deeplinks",
    oldPrefix: "@dvnt/app/src/routing/deeplinks/",
    newExact: "@dvnt/app/lib/deep-linking/deeplinks",
    newPrefix: "@dvnt/app/lib/deep-linking/deeplinks/",
  },
];

function rewriteSpecifier(spec: string): string | null {
  for (const r of RULES) {
    if (spec === r.oldExact) return r.newExact;
    if (spec.startsWith(r.oldPrefix))
      return r.newPrefix + spec.slice(r.oldPrefix.length);
  }
  return null;
}

const project = new Project({
  // Don't rely on a single tsconfig — sweep the whole workspace surface the
  // proposal names: packages/app + apps/web + apps/mobile.
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

  // Dynamic import(...) / require(...) string literals, if any.
  for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const parentKind = lit.getParentIfKind(SyntaxKind.CallExpression);
    if (!parentKind) continue;
    const callee = parentKind.getExpression().getText();
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
  `\nws6-final codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
