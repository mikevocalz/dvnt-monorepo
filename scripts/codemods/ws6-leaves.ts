/**
 * WS-6 structure migration — PR 2 (leaf features), import codemod.
 *
 * Behavior-preserving: these self-contained leaf features moved from
 *   packages/app/src/<x>/**      ->  packages/app/features/<x>/**
 * via `git mv` (internal relative imports unchanged by the rename). This
 * codemod only rewrites the EXTERNAL alias specifier consumers use:
 *
 *   @dvnt/app/src/<x>            ->  @dvnt/app/features/<x>
 *   @dvnt/app/src/<x>/<deep>     ->  @dvnt/app/features/<x>/<deep>
 *
 * for x in:
 *   stories-editor, stickers, crop, watch, live-surface,
 *   camera, gpu, ticket, services
 *
 * ZERO logic edits — import/export module specifiers only, so the PR is
 * reviewable by diff shape alone. Re-runnable (idempotent): once the old
 * paths are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-leaves.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const FEATURES = [
  "stories-editor",
  "stickers",
  "crop",
  "watch",
  "live-surface",
  "camera",
  "gpu",
  "ticket",
  "services",
] as const;

const RULES = FEATURES.map((f) => ({
  oldExact: `@dvnt/app/src/${f}`,
  oldPrefix: `@dvnt/app/src/${f}/`,
  newExact: `@dvnt/app/features/${f}`,
  newPrefix: `@dvnt/app/features/${f}/`,
}));

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
  `\nws6-leaves codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
