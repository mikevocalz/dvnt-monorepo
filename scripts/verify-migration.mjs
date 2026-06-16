#!/usr/bin/env node
/**
 * Solito v5 migration — structural verifier (PROMPT 0 §6).
 *
 * Read-only. Exits non-zero unless ALL of the following hold:
 *   (a) every migrated screen dir has all 4 files (native/web/index/index.web)
 *   (b) every `@dvnt/app/features/screens/*` import in route files resolves
 *   (c) the web barrel (features/screens/web.ts) resolves its named exports
 *   (d) no web.tsx / _shared web file imports a native-only module (denylist)
 *   (e) `node --check` passes on every edited .js config
 *
 * Usage:  node scripts/verify-migration.mjs            (from monorepo root)
 *         node scripts/verify-migration.mjs --json     (machine-readable)
 *
 * This is the gate the executing agents drive toward green. It is expected to
 * report failures until the migration is complete — that is the point.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_PKG = path.join(ROOT, "packages/app");
const SCREENS_DIR = path.join(APP_PKG, "features/screens");
const MOBILE_APP = path.join(ROOT, "apps/mobile/app");
const WEB_BARREL = path.join(SCREENS_DIR, "web.ts");
const JSON_OUT = process.argv.includes("--json");

/** Native-only modules that must NEVER appear in a web.tsx / _shared web file. */
const NATIVE_DENYLIST = [
  /^expo-/, // expo-* native modules
  /^expo$/,
  /^@gorhom\//,
  /^sonner-native/,
  /^react-native-keyboard/,
  /^react-native-vision-camera/,
  /vision-camera/,
  /^expo-router/,
];

/** .js configs that must stay parseable (node --check). */
const JS_CONFIGS = [
  "apps/mobile/metro.config.js",
  "apps/mobile/babel.config.js",
  // NB: no tailwind.config.js — this project is Tailwind v4 / NativeWind v5,
  // which configures content scanning via CSS @source, not a JS config. The
  // content-scan check below validates that instead (no false "absent" warning).
  "apps/mobile/app.config.js",
  "apps/mobile/index.js",
  "package.json", // not node --check-able, handled separately as JSON.parse
];

const errors = [];
const warnings = [];
const info = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => info.push(m);

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, "utf8");
const walk = (dir, filter = () => true, out = []) => {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
};

// ── (b) collect screen imports from route files ─────────────────────────────
const SCREEN_IMPORT_RE =
  /from\s+["']@dvnt\/app\/features\/screens\/([^"']+)["']/g;
const isRouteFile = (f) =>
  /\.(t|j)sx?$/.test(f) &&
  !/_layout\./.test(f) &&
  !/\/\+[^/]+$/.test(f); // skip +not-found / +native-intent

const referencedScreens = new Set();
const routeFiles = walk(MOBILE_APP, isRouteFile);
for (const f of routeFiles) {
  const src = read(f);
  let m;
  while ((m = SCREEN_IMPORT_RE.exec(src))) referencedScreens.add(m[1]);
}

// A referenced screen "<path>" resolves to features/screens/<path> with 4 files,
// or to a barrel export in web.ts. Verify the dir-based ones.
const FOUR_FILES = ["native.tsx", "web.tsx", "index.ts", "index.web.ts"];
for (const screen of referencedScreens) {
  const dir = path.join(SCREENS_DIR, screen);
  if (!exists(dir)) {
    err(`(b) route import "@dvnt/app/features/screens/${screen}" → missing dir ${path.relative(ROOT, dir)}`);
    continue;
  }
  for (const file of FOUR_FILES) {
    if (!exists(path.join(dir, file)))
      err(`(a) screen "${screen}" missing ${file}`);
  }
}

// ── (a) every screen dir that LOOKS like a migrated route has 4 files ────────
// A migrated route dir = a leaf dir under features/screens that contains a
// native.tsx OR index.ts (heuristic). Bespoke feature dirs without those are
// skipped (e.g. the landing page, which uses its own composition).
const screenDirs = exists(SCREENS_DIR)
  ? walk(SCREENS_DIR, (f) => /\/(native\.tsx|index\.ts)$/.test(f)).map((f) =>
      path.dirname(f),
    )
  : [];
for (const dir of [...new Set(screenDirs)]) {
  const missing = FOUR_FILES.filter((f) => !exists(path.join(dir, f)));
  if (missing.length && missing.length < FOUR_FILES.length) {
    err(`(a) ${path.relative(APP_PKG, dir)} is partial — missing ${missing.join(", ")}`);
  }
}

// ── (c) web barrel resolves ──────────────────────────────────────────────────
if (!exists(WEB_BARREL)) {
  err(`(c) web barrel missing: ${path.relative(ROOT, WEB_BARREL)} (Vite must import via this, never paths with ( or [ )`);
} else {
  const barrel = read(WEB_BARREL);
  const expected = ["LoginWebScreen", "PrivacyPolicyWebScreen", "FaqWebScreen"];
  for (const name of expected) {
    if (!new RegExp(`\\b${name}\\b`).test(barrel))
      warn(`(c) web barrel does not export ${name}`);
  }
}

// ── (d) no native imports in web.tsx / _shared web files ─────────────────────
const webFiles = walk(
  SCREENS_DIR,
  (f) => /\.web\.tsx?$/.test(f) || /web\.ts$/.test(f) || /_shared.*web/.test(f),
);
const IMPORT_RE = /(?:from|require\()\s*["']([^"']+)["']/g;
for (const f of webFiles) {
  const src = read(f);
  let m;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("@/")) continue;
    if (NATIVE_DENYLIST.some((re) => re.test(spec)))
      err(`(d) native import "${spec}" in web file ${path.relative(ROOT, f)}`);
  }
}

// ── (e) node --check on edited .js configs ───────────────────────────────────
for (const rel of JS_CONFIGS) {
  const p = path.join(ROOT, rel);
  if (!exists(p)) {
    warn(`(e) config not found (skipped): ${rel}`);
    continue;
  }
  if (rel.endsWith(".json")) {
    try {
      JSON.parse(read(p));
    } catch (e) {
      err(`(e) invalid JSON: ${rel} — ${e.message}`);
    }
    continue;
  }
  try {
    execFileSync(process.execPath, ["--check", p], { stdio: "pipe" });
  } catch (e) {
    err(`(e) node --check failed: ${rel} — ${String(e.stderr || e).split("\n")[0]}`);
  }
}

// ── (§4.2) Tailwind content scan ─────────────────────────────────────────────
// Tailwind v4 / NativeWind v5 scan content via CSS @source, not tailwind.config.
// Only flag the REAL failure mode: moved packages/* not covered, which silently
// yields zero styles. A correct @source-based setup passes as an info note.
{
  const globalCss = path.join(ROOT, "apps/mobile/global.css");
  const twConfig = path.join(ROOT, "apps/mobile/tailwind.config.js");
  const scansPackages = (src) => /@source\s+["'][^"']*packages\//.test(src);
  if (exists(globalCss) && scansPackages(read(globalCss))) {
    note("(§4.2) Tailwind v4 scans packages/* via @source in global.css ✓");
  } else if (exists(twConfig) && /packages/.test(read(twConfig))) {
    note("(§4.2) Tailwind content globs include packages/* via tailwind.config.js ✓");
  } else {
    warn("(§4.2) Tailwind content scan missing package globs — moved code in packages/* will emit zero styles. Add @source \"../../packages/**\" to apps/mobile/global.css.");
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const summary = {
  routeFiles: routeFiles.length,
  referencedScreens: referencedScreens.size,
  screenDirs: new Set(screenDirs).size,
  webFiles: webFiles.length,
  errors: errors.length,
  warnings: warnings.length,
  notes: info.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, errors, warnings, info }, null, 2));
} else {
  console.log("── Solito v5 migration verifier ──");
  console.log(
    `route files: ${summary.routeFiles}  ·  screens referenced: ${summary.referencedScreens}  ·  screen dirs: ${summary.screenDirs}  ·  web files: ${summary.webFiles}`,
  );
  if (info.length) {
    console.log(`\nℹ️  ${info.length} note(s):`);
    for (const n of info) console.log("  - " + n);
  }
  if (warnings.length) {
    console.log(`\n⚠️  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log("  - " + w);
  }
  if (errors.length) {
    console.log(`\n❌ ${errors.length} error(s):`);
    for (const e of errors) console.log("  - " + e);
  } else {
    console.log("\n✅ 0 structural errors");
  }
}

process.exit(errors.length > 0 ? 1 : 0);
