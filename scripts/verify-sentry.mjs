#!/usr/bin/env node
/**
 * Guards the observability config against the failure mode that produced the
 * audit: options that read plausibly, are never type-checked against the
 * installed SDK, and cost the free-tier quota every 30 seconds.
 *
 * `Sentry.init` takes `any` at both call sites (initExpoSentry(Sentry: any)),
 * so tsc cannot catch a misspelled or removed option. `enableInExpoDevelopment`
 * and `enableHermes` sat in the config for months doing nothing for exactly
 * this reason. Section 1 is the check tsc cannot do.
 *
 *   node scripts/verify-sentry.mjs
 */
import assert from "node:assert";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(root, p), "utf8");

const EXPO_INIT = "packages/observability/src/init/expo.ts";
const BOOT = "packages/app/lib/sentry-boot.native.ts";
const expoInit = read(EXPO_INIT);
const boot = read(BOOT);

const sdkDir = dirname(require.resolve("@sentry/react-native/package.json"));
const installedVersion = require("@sentry/react-native/package.json").version;

// --- 1. No option passed to Sentry.init is absent from the installed typings --
// The option object literal inside initExpoSentry's Sentry.init(...) call.
const initBody = expoInit.slice(
  expoInit.indexOf("Sentry.init({"),
  expoInit.indexOf("\n  });", expoInit.indexOf("Sentry.init({")),
);
assert.ok(initBody.length > 200, "could not locate the Sentry.init option literal");

// Top-level keys only: two-space indent inside the literal, `key:` or `...(`.
const passed = [...initBody.matchAll(/^ {4}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]);
assert.ok(passed.length > 10, `parsed only ${passed.length} options — parser drifted`);

const typings = [
  "dist/js/options.d.ts",
  "dist/js/client.d.ts",
]
  .map((p) => {
    try {
      return readFileSync(join(sdkDir, p), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");
const coreOptions = readFileSync(
  join(dirname(require.resolve("@sentry/core/package.json")), "build/types/types/options.d.ts"),
  "utf8",
);
const declared = new Set(
  [...`${typings}\n${coreOptions}`.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/gm)].map((m) => m[1]),
);
const unknown = passed.filter((k) => !declared.has(k));
assert.deepStrictEqual(
  unknown,
  [],
  `options not present in @sentry/react-native@${installedVersion} typings: ${unknown.join(", ")}`,
);
console.log(`1. OK — ${passed.length} init options all exist in ${installedVersion} typings`);

// --- 2. The two main-thread/quota defaults stay off ---------------------------
// attachViewHierarchy: a native view-tree walk on the main thread at error
// time. enableUserInteractionTracing: a span per touch.
for (const opt of ["attachViewHierarchy", "enableUserInteractionTracing"]) {
  assert.match(
    expoInit,
    new RegExp(`${opt}:\\s*false`),
    `${opt} must be false in ${EXPO_INIT} (SDK default is false; true is the audit finding)`,
  );
}
console.log("2. OK — attachViewHierarchy and enableUserInteractionTracing are off");

// --- 3. TurboModule aggregate stats disabled, slow-call breadcrumbs off -------
// The billed level:'info' event every 30s. Largest single quota item.
const turbo = boot.match(/turboModuleContextIntegration\(\{[\s\S]*?\}\)/);
assert.ok(turbo, `${BOOT} must pass turboModuleContextIntegration explicit options`);
assert.match(turbo[0], /enableAggregateStats:\s*false/, "enableAggregateStats must be false");
assert.match(turbo[0], /slowCallThresholdMs:\s*0/, "slowCallThresholdMs must be 0");
// And the override has to actually win the name collision against the default.
const filterDuplicates = readFileSync(
  join(dirname(require.resolve("@sentry/core/package.json")), "build/cjs/integration.js"),
  "utf8",
);
assert.match(
  filterDuplicates,
  /existingInstance && !existingInstance\.isDefaultInstance && currentInstance\.isDefaultInstance/,
  "@sentry/core filterDuplicates no longer keeps the last non-default instance — the turboModuleContextIntegration override may not win",
);
console.log("3. OK — TurboModule aggregate off, and last-instance-wins still holds");

// --- 4. No mobile replay anywhere ---------------------------------------------
// Replay is removed globally (50/mo pool, no sampling contract). The SDK adds
// its own only when a replay sample rate is set, so guard both.
assert.ok(
  !/Sentry\.mobileReplayIntegration\(/.test(boot),
  `${BOOT} must not push mobileReplayIntegration`,
);
for (const opt of ["replaysSessionSampleRate", "replaysOnErrorSampleRate"]) {
  // `opt:` — passed as an option, as opposed to named in a comment.
  const assigned = new RegExp(`(^|[^\\w.])${opt}\\s*:`, "m");
  assert.ok(
    !assigned.test(stripComments(expoInit)) && !assigned.test(stripComments(boot)),
    `${opt} on mobile re-arms the SDK's own mobileReplayIntegration (default.js:117-121)`,
  );
}
assert.ok(!expoInit.includes("replaysEnabled"), "the unread replaysEnabled option must stay deleted");
console.log("4. OK — no mobile replay, and nothing re-arms the SDK's own");

// --- 5. Exactly one enablePromiseRejectionTracker call -------------------------
// Single-slot Hermes API: the second call replaces the first. The SDK's
// reactNativeErrorHandlersIntegration owns it.
const trackerHits = grepRepo(/enablePromiseRejectionTracker/).filter((f) =>
  // Naming it in a comment is documentation; calling it is the bug.
  /enablePromiseRejectionTracker\s*(\?\.)?\(/.test(stripComments(read(f))),
);
assert.strictEqual(
  trackerHits.length,
  0,
  `enablePromiseRejectionTracker is a single-slot API owned by the SDK; found in: ${trackerHits.join(", ")}`,
);
console.log("5. OK — no app-level enablePromiseRejectionTracker competing with the SDK");

// --- 6. Mobile uses the shared sampler ----------------------------------------
assert.match(
  boot,
  /dvntTracesSampler/,
  `${BOOT} must import dvntTracesSampler from @dvnt/observability rather than defining its own inline sampler (the chatty->0 bucket and the Lynk boost live there)`,
);
console.log("6. OK — mobile is on the shared dvntTracesSampler");

// --- 7. The version cited in the boot header is the installed version ---------
const cited = boot.match(/@sentry\/react-native\s+(\d+\.\d+\.\d+)/);
assert.ok(cited, `${BOOT} header must cite the version its symbols were verified against`);
assert.strictEqual(
  cited[1],
  installedVersion,
  `${BOOT} header cites ${cited[1]} but ${installedVersion} is installed — re-verify the symbols, then update the header`,
);
console.log(`7. OK — boot header cites ${installedVersion}, which is installed`);

// --- 8. Exactly one io.sentry:sentry-android version in the build ------------
// sentry-java's InitUtil.shouldInit enforces version consistency at init; two
// coordinates on the classpath is a crash on LAUNCH, not a caught exception
// (getsentry/sentry-react-native#5682). Today the RN SDK is the only source.
//
// This is deliberately a CHECK and not a Gradle resolutionStrategy.force: a
// forced alignment would silently ship an untested pairing, while a mixed
// version is exactly the thing you want to hear about before it reaches a
// device. It also survives `expo prebuild --clean`, which a constraint written
// into apps/mobile/android/ would not — that directory is committed prebuild
// output and gets regenerated.
const gradleFiles = execFileSync(
  "sh",
  [
    "-c",
    "find node_modules/@sentry apps/mobile/android -type f \\( -name '*.gradle' -o -name '*.gradle.kts' \\) 2>/dev/null",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const versions = new Map();
for (const rel of gradleFiles) {
  const text = readFileSync(join(root, rel), "utf8");
  // Literal coordinates, plus the `def sentryAndroidVersion = 'x'` indirection
  // the RN SDK actually uses.
  for (const m of text.matchAll(/io\.sentry:sentry-android(?:-[\w-]+)?:([\d.]+)/g)) {
    versions.set(m[1], rel);
  }
  for (const m of text.matchAll(/sentryAndroidVersion\s*=\s*['"]([\d.]+)['"]/g)) {
    versions.set(m[1], rel);
  }
}
assert.ok(versions.size > 0, "found no sentry-android coordinate at all — the scan drifted");
assert.strictEqual(
  versions.size,
  1,
  `mixed io.sentry:sentry-android versions will crash on launch (InitUtil.shouldInit): ${[
    ...versions,
  ]
    .map(([v, f]) => `${v} (${f})`)
    .join(", ")}`,
);
console.log(`8. OK — one sentry-android version in the build (${[...versions.keys()][0]})`);

// --- 9. The web rail keeps its noise floor and its replay gate ---------------
// The mobile audit recorded these as open; they were in fact shipped 2026-08-09
// (1697cd1), a week before the commit that audit cites. Asserted here so the
// next re-audit does not have to rediscover it, and so a refactor cannot quietly
// drop them — the web rail carries the larger share of the 5,000-error quota.
const WEB_CONFIGS = [
  "apps/web/src/instrumentation-client.ts",
  "apps/web/sentry.server.config.ts",
  "apps/web/sentry.edge.config.ts",
];
for (const rel of WEB_CONFIGS) {
  const text = read(rel);
  assert.match(text, /ignoreErrors:/, `${rel} has no ignoreErrors — DVNT-WEB-A noise spends quota`);
  assert.match(
    text,
    /webkit\\?\.messageHandlers/,
    `${rel} must filter the Safari extension bridge (DVNT-WEB-A)`,
  );
  assert.match(
    text,
    /dvntTracesSampler/,
    `${rel} must use the shared sampler, not a private copy`,
  );
}
// The replay pool is 50/month and one issue already ate 51. The error-replay
// gate is the only thing standing between a noisy bug and the whole pool.
const client = read(WEB_CONFIGS[0]);
assert.match(client, /beforeErrorSampling:/, "the error-replay gate is unwired");
assert.ok(
  /replaysOnErrorSampleRate:\s*(0(\.\d+)?)\b/.test(client),
  "replaysOnErrorSampleRate must be set below 1.0 on web",
);
assert.ok(
  /replaysSessionSampleRate:\s*0\.\d+/.test(client),
  "replaysSessionSampleRate must be explicitly sampled on web",
);
console.log(`9. OK — web rail: ${WEB_CONFIGS.length} configs filtered + sampled, replay gate wired`);

// --- 10. The two billed-by-default knobs stay decided ------------------------
// profilesSampleRate is a BILLED category that appeared in no budget line, and
// the app-hang threshold at the 2s default reports normal cold starts as
// freezes. Both are now explicit; a silent revert to an SDK default is a quota
// regression nobody would see in a diff.
assert.match(
  expoInit,
  /profilesSampleRate:\s*config\.profilesSampleRate\s*\?\?\s*0\b/,
  "profiling must default OFF — its free-tier allowance is unverified",
);
assert.match(
  expoInit,
  /appHangTimeoutInterval:/,
  "app-hang tracking must carry an explicit threshold, not the 2s SDK default",
);
console.log("10. OK — profiling defaults off, hang threshold explicit");

console.log("\nverify-sentry: all sections pass");

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function grepRepo(re) {
  const { execFileSync } = require("node:child_process");
  const out = execFileSync(
    "git",
    ["grep", "-l", "-E", re.source, "--", "*.ts", "*.tsx", "*.js", "*.mjs"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  return out ? out.split("\n").filter((f) => !f.startsWith("scripts/verify-sentry")) : [];
}
