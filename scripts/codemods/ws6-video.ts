/**
 * WS-6 structure migration — PR 1 (video), import codemod.
 *
 * Behavior-preserving: the `video` feature moved from
 *   packages/app/src/video/**      ->  packages/app/features/video/**
 * via `git mv`. Internal relative imports are unchanged by the directory
 * rename; this codemod only rewrites the EXTERNAL alias specifier that
 * consumers use to reach into the feature:
 *
 *   @dvnt/app/src/video            ->  @dvnt/app/features/video
 *   @dvnt/app/src/video/<deep>     ->  @dvnt/app/features/video/<deep>
 *
 * ZERO logic edits — this touches import/export module specifiers only, so the
 * PR remains reviewable by diff shape alone. Re-runnable (idempotent): once the
 * old paths are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-video.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const OLD_EXACT = "@dvnt/app/src/video";
const OLD_PREFIX = "@dvnt/app/src/video/";
const NEW_EXACT = "@dvnt/app/features/video";
const NEW_PREFIX = "@dvnt/app/features/video/";

function rewriteSpecifier(spec: string): string | null {
  if (spec === OLD_EXACT) return NEW_EXACT;
  if (spec.startsWith(OLD_PREFIX)) return NEW_PREFIX + spec.slice(OLD_PREFIX.length);
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
  `\nws6-video codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
