/**
 * WS-6 structure migration — PR 4 (feature-owned component buckets), import codemod.
 *
 * Behavior-preserving: these clearly FEATURE-OWNED component buckets moved from
 *   packages/app/components/<x>/**   ->  packages/app/features/<x>/ui/**
 * via `git mv`. Internal relative imports are unchanged by the rename (each
 * bucket moves as a whole subtree, and none of them reach OUT of the bucket via
 * relative paths — verified: all external references use the `@dvnt/app/*`
 * alias). This codemod only rewrites the EXTERNAL alias specifier consumers use
 * to reach into each bucket:
 *
 *   @dvnt/app/components/<x>          ->  @dvnt/app/features/<x>/ui
 *   @dvnt/app/components/<x>/<deep>   ->  @dvnt/app/features/<x>/ui/<deep>
 *
 * for x in:
 *   scanner, share, stories, tags, reports, signup, verification   (new features)
 *   auth, call, comments, events, post, profile, settings          (existing features)
 *
 * NOTE ON PRECISION: `components/event` (singular, event-card.tsx sibling files),
 * `components/events` (plural, MOVED) — the rules below match the FULL segment
 * only (exact or followed by `/`), so `@dvnt/app/components/event-card` and
 * `@dvnt/app/components/eventsomething` are never touched.
 *
 * ZERO logic edits — import/export module specifiers only, so the PR is
 * reviewable by diff shape alone. Re-runnable (idempotent): once the old paths
 * are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-components.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BUCKETS = [
  "scanner",
  "share",
  "stories",
  "tags",
  "reports",
  "signup",
  "verification",
  "auth",
  "call",
  "comments",
  "events",
  "post",
  "profile",
  "settings",
] as const;

const RULES = BUCKETS.map((b) => ({
  oldExact: `@dvnt/app/components/${b}`,
  oldPrefix: `@dvnt/app/components/${b}/`,
  newExact: `@dvnt/app/features/${b}/ui`,
  newPrefix: `@dvnt/app/features/${b}/ui/`,
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
  `\nws6-components codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
