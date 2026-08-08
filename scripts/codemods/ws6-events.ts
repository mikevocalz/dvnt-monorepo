/**
 * WS-6 structure migration — PR 5 (events merge), import codemod.
 *
 * Behavior-preserving: the shared/native half of the `events` feature moved OUT of
 *   packages/app/src/events/**   ->  packages/app/features/events/**
 * merging into the web-screen half already living at packages/app/features/events/.
 * Concretely, via `git mv`:
 *   src/events/types.ts            -> features/events/types.ts
 *   src/events/promotion-types.ts  -> features/events/promotion-types.ts
 *   src/events/ui/*                -> features/events/ui/*   (incl. the ui barrel)
 *
 * Every path under src/events/ maps to the SAME relative path under
 * features/events/, so the external alias rewrite is a single clean prefix swap:
 *
 *   @dvnt/app/src/events         ->  @dvnt/app/features/events
 *   @dvnt/app/src/events/<deep>  ->  @dvnt/app/features/events/<deep>
 *
 * covering /types, /promotion-types, /ui, /ui/OrganizerCard.web, etc.
 *
 * Internal relative imports are unchanged by the rename: the four ui/ files that
 * import `../types` keep resolving because types.ts moved FLAT to
 * features/events/types.ts (sibling-parent of features/events/ui/), and the
 * OrganizerCard.tsx / OrganizerCard.web.tsx platform pair moved together so the
 * web/native leg resolution is identical before and after.
 *
 * NOTE: `packages/app/lib/api/event-organizer.ts` used a RELATIVE specifier
 * (`../../src/events/types`) rather than the alias; ts-morph string rules below
 * only touch the alias, so that one straggler is hand-fixed to
 * `../../features/events/types` in the same PR.
 *
 * NOTE ON PRECISION: rules match the FULL `@dvnt/app/src/events` segment only
 * (exact, or followed by `/`), so no unrelated `src/events*` specifier is touched.
 *
 * ZERO logic edits — import/export module specifiers only, so the PR is
 * reviewable by diff shape alone. Re-runnable (idempotent): once the old paths
 * are gone it rewrites nothing.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-events.ts
 */

import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const RULES = [
  {
    oldExact: "@dvnt/app/src/events",
    oldPrefix: "@dvnt/app/src/events/",
    newExact: "@dvnt/app/features/events",
    newPrefix: "@dvnt/app/features/events/",
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
  `\nws6-events codemod: ${specifiersRewritten} specifier(s) across ${filesChanged} file(s).`,
);
