/**
 * WS-6 boundary cleanup — feature-barrel routing codemod.
 *
 * Rule (c) of the boundary lint (packages/app/eslint.config.mjs) forbids reaching
 * into another feature's internals through the alias:
 *
 *   @dvnt/app/features/<feature>/{api,hooks,stores,ui,components,screens,types}/**
 *
 * Consumers must import the feature's PUBLIC BARREL instead
 * (`@dvnt/app/features/<feature>`). This codemod rewrites module specifiers ONLY
 * (zero logic edits) and splits by importer location:
 *
 *   CROSS-feature (importer is in a different feature, or outside features/):
 *     @dvnt/app/features/<F>/ui/Foo   ->  @dvnt/app/features/<F>
 *   INTRA-feature (importer lives inside the SAME feature <F>):
 *     @dvnt/app/features/<F>/ui/Foo   ->  a RELATIVE path to that same file
 *     (relative deep imports are legal within a feature; this keeps platform
 *      forks like `weather-strip.web` resolving exactly as before).
 *
 * The feature-root barrels are hand-maintained to re-export every symbol the
 * cross-feature consumers pull — this script never edits a barrel, only the
 * consumers' specifiers.
 *
 * Idempotent: once a consumer already imports the bare barrel (or a relative
 * path) there is nothing left matching the deep-alias pattern, so a re-run
 * rewrites nothing. A deep import a human deliberately kept (because barrel
 * routing would drag web-incompatible / heavy code into a web-reachable module)
 * is opted OUT with an `eslint-disable-next-line no-restricted-imports` comment
 * directly above it — this codemod SKIPS any declaration carrying that guard, so
 * a re-run never clobbers a sanctioned exception.
 *
 * Run:  node_modules/.bin/tsx scripts/codemods/ws6-barrels.ts
 */

import { Node, Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_ROOT = path.join(REPO_ROOT, "packages", "app");

// The lint's forbidden segments (rule c).
const SEGMENTS =
  "(?:api|hooks|stores|ui|components|screens|types)";
// Matches @dvnt/app/features/<feature>/<segment>/<rest...> (deep, not the bare barrel).
const DEEP_RE = new RegExp(
  `^@dvnt/app/features/([^/]+)/${SEGMENTS}/.+$`,
);

/** Feature that OWNS the given source file, or null if it is not under features/. */
function ownerFeature(filePath: string): string | null {
  const rel = path.relative(APP_ROOT, filePath);
  if (rel.startsWith("..")) return null;
  const m = rel.match(/^features\/([^/]+)\//);
  return m ? m[1] : null;
}

/** The feature targeted by a deep-alias specifier, plus its post-alias tail. */
function parseDeep(spec: string): { feature: string; tail: string } | null {
  const m = spec.match(DEEP_RE);
  if (!m) return null;
  const feature = m[1];
  // tail = everything after "@dvnt/app/features/<feature>/"
  const tail = spec.slice(`@dvnt/app/features/${feature}/`.length);
  return { feature, tail };
}

/**
 * Compute the rewritten specifier for `spec` as imported from `fromFile`.
 * Returns null when `spec` is not a deep-alias import.
 */
function rewrite(spec: string, fromFile: string): string | null {
  const parsed = parseDeep(spec);
  if (!parsed) return null;
  const importer = ownerFeature(fromFile);

  // INTRA-feature: rewrite to a relative path to the same target file.
  if (importer === parsed.feature) {
    const targetAbs = path.join(APP_ROOT, "features", parsed.feature, parsed.tail);
    let relPath = path.relative(path.dirname(fromFile), targetAbs);
    if (!relPath.startsWith(".")) relPath = "./" + relPath;
    // Keep POSIX separators in the specifier.
    return relPath.split(path.sep).join("/");
  }

  // CROSS-feature (or non-feature consumer): route through the public barrel.
  return `@dvnt/app/features/${parsed.feature}`;
}

/** True when an import/export decl is opted out via a preceding eslint-disable. */
function hasBarrelOptOut(decl: Node): boolean {
  const full = decl.getFullText();
  const leading = full.slice(0, full.length - decl.getText().length);
  return /eslint-disable(?:-next-line)?[^\n]*no-restricted-imports/.test(leading);
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: true },
});

project.addSourceFilesAtPaths([
  path.join(APP_ROOT, "**/*.{ts,tsx}"),
  "!" + path.join(REPO_ROOT, "**/node_modules/**"),
  "!" + path.join(APP_ROOT, "**/.next/**"),
  "!" + path.join(APP_ROOT, "**/.expo/**"),
  "!" + path.join(APP_ROOT, "**/.turbo/**"),
  "!" + path.join(APP_ROOT, "**/dist/**"),
  "!" + path.join(APP_ROOT, "**/build/**"),
]);

let filesChanged = 0;
let intra = 0;
let cross = 0;

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  let touched = false;

  const decls = [
    ...sourceFile.getImportDeclarations(),
    ...sourceFile.getExportDeclarations(),
  ];
  for (const decl of decls) {
    const spec = decl.getModuleSpecifierValue();
    if (!spec) continue;
    if (hasBarrelOptOut(decl)) continue; // sanctioned deep import — never touch.
    const next = rewrite(spec, filePath);
    if (next && next !== spec) {
      const isIntra = next.startsWith(".");
      decl.setModuleSpecifier(next);
      isIntra ? intra++ : cross++;
      touched = true;
    }
  }

  // Dynamic import(...) / require(...) string literals.
  for (const lit of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const call = lit.getParentIfKind(SyntaxKind.CallExpression);
    if (!call) continue;
    const callee = call.getExpression().getText();
    if (callee !== "require" && callee !== "import") continue;
    const next = rewrite(lit.getLiteralValue(), filePath);
    if (next && next !== lit.getLiteralValue()) {
      const isIntra = next.startsWith(".");
      lit.setLiteralValue(next);
      isIntra ? intra++ : cross++;
      touched = true;
    }
  }

  if (touched) {
    filesChanged++;
    console.log("  rewrote", path.relative(REPO_ROOT, filePath));
  }
}

project.saveSync();

console.log(
  `\nws6-barrels codemod: ${cross} cross-feature -> barrel, ${intra} intra-feature -> relative, across ${filesChanged} file(s).`,
);
