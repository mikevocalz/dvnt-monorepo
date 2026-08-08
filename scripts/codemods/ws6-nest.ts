/**
 * WS-6 structure migration — PR 3 (un-nest src/features/*), import codemod.
 *
 * Behavior-preserving: these features lifted OUT of the nested
 *   packages/app/src/features/<x>/**   ->  packages/app/features/<x>/**
 * (removing the features-under-src-under-a-features-root nesting) via `git mv`.
 * Internal relative imports are unchanged by the directory rename — including
 * the weatherfx <-> weatheraudio sibling relative imports, since both move
 * together and stay siblings. This codemod only rewrites the EXTERNAL alias
 * specifier consumers use to reach into each feature:
 *
 *   @dvnt/app/src/features/<x>         ->  @dvnt/app/features/<x>
 *   @dvnt/app/src/features/<x>/<deep>  ->  @dvnt/app/features/<x>/<deep>
 *
 * for x in:
 *   calls, likes, posts, weatherfx, weatheraudio
 *
 * ZERO logic edits — import/export module specifiers only, so the PR is
 * reviewable by diff shape alone. Re-runnable (idempotent): once the old
 * paths are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-nest.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const FEATURES = [
  "calls",
  "likes",
  "posts",
  "weatherfx",
  "weatheraudio",
] as const;

const RULES = FEATURES.map((f) => ({
  oldExact: `@dvnt/app/src/features/${f}`,
  oldPrefix: `@dvnt/app/src/features/${f}/`,
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
  `\nws6-nest codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
