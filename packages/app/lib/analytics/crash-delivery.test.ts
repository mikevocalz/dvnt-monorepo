import assert from "node:assert/strict";
import { after, beforeEach, test, mock } from "node:test";
import { createRequire, registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const native = require("./test-support/native-runtime.cjs");
const stub = new URL("./test-support/native-runtime.cjs", import.meta.url).href;
const appRoot = new URL("../../", import.meta.url);
const obsRoot = new URL("../../../observability/src/", import.meta.url);
const readerUrl = new URL("../native-exception-log.ts", import.meta.url).href;

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (["react-native", "nativewind", "expo-file-system", "expo-file-system/legacy",
      "@dvnt/app/lib/mmkv-zustand", "@dvnt/app/lib/supabase/client"].includes(specifier)) {
      return { url: stub, shortCircuit: true };
    }
    if (specifier.startsWith("@dvnt/app/")) {
      return { url: new URL(`${specifier.slice(10)}.ts`, appRoot).href, shortCircuit: true };
    }
    if (specifier === "@dvnt/observability/capture") {
      return { url: new URL("capture.ts", obsRoot).href, shortCircuit: true };
    }
    // Metro resolves extensionless relative imports in the shared package.
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      // Convert via the href string. existsSync accepts a URL at runtime, but
      // this resolves to the DOM URL, which is assignable to neither node:fs
      // PathLike nor node:url's own URL, so both forms fail the typecheck.
      if (existsSync(fileURLToPath(candidate.href))) return { url: candidate.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.startsWith(readerUrl)) {
      // Metro provides require alongside ES imports; Node's TS loader does not.
      return { ...result, source:
        `import { createRequire as testRequire } from 'node:module';\nconst require = testRequire(import.meta.url);\n${result.source}` };
    }
    return result;
  },
});

const realFetch = globalThis.fetch;
const oldDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const JS_KEY = "DVNT_LAST_JS_ERROR";
const RECEIPTS_KEY = "DVNT_REPORTED_CRASH_RECEIPTS_V2";
const payload = {
  timestamp: "2026-09-19T01:00:00.000Z", source: "errorutils", isFatal: true,
  name: "TypeError", message: "Cannot read property 'id' of null",
  stack: "at save (app:///main.jsbundle:1:100)\nat onPress (app:///main.jsbundle:1:200)",
};
let responses: Array<Record<string, any>> = [];
let status = 200;
let boot = 0;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function launch() {
  const mod = await import(`${readerUrl}?launch=${++boot}`);
  await settle();
  return mod;
}

beforeEach(() => {
  mock.restoreAll();
  native.mmkv.clearAll();
  native.disk.contents = null;
  native.disk.removals = 0;
  native.Platform.OS = "ios";
  native.analytics.fail = false;
  native.analytics.rows.length = 0;
  native.themeCalls.length = 0;
  responses = [];
  status = 200;
  process.env.EXPO_PUBLIC_SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/1";
  mock.method(console, "error", () => {});
  mock.method(console, "warn", () => {});
  globalThis.fetch = (async (_url, init) => {
    responses.push(JSON.parse(String(init?.body).trim().split("\n")[2]));
    return new Response("{}", { status });
  }) as typeof fetch;
});

after(() => {
  hooks.deregister();
  globalThis.fetch = realFetch;
  if (oldDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = oldDsn;
  mock.restoreAll();
});

test("offline relaunch retains the JS error, then successful delivery clears it with its stack", async () => {
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  globalThis.fetch = async () => { throw new Error("offline"); };
  await launch();
  assert.equal(native.mmkv.getString(JS_KEY), JSON.stringify(payload));
  assert.equal(native.mmkv.getString(RECEIPTS_KEY), undefined);
  globalThis.fetch = (async (_url, init) => {
    responses.push(JSON.parse(String(init?.body).trim().split("\n")[2]));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await launch();
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
  assert.equal(responses.length, 1);
  const event = responses[0];
  assert.equal(event.timestamp, Date.parse(payload.timestamp) / 1000);
  assert.equal(event.exception.values[0].stacktrace.frames.at(-1).function, "save");
  assert.equal(event.exception.values[0].mechanism.handled, false);
  assert.equal(event.level, "fatal");
});

test("HTTP 429 does not acknowledge either persisted source even when analytics succeeds", async () => {
  status = 429;
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  native.disk.contents = JSON.stringify({ ...payload, reason: payload.message, callStackSymbols: [] });
  await launch();
  assert.ok(native.mmkv.getString(JS_KEY));
  assert.ok(native.disk.contents);
  assert.equal(native.disk.removals, 0);
  assert.equal(native.mmkv.getString(RECEIPTS_KEY), undefined);
  assert.equal(native.analytics.rows.length, 2);
  status = 200;
  await launch();
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
  assert.equal(native.disk.contents, null);
  assert.equal(native.disk.removals, 1);
  // The retry went to Sentry only; analytics already had both rows.
  assert.equal(native.analytics.rows.length, 2);
});

test("missing DSN: five boots write one analytics row per crash and release both sources", async () => {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  native.disk.contents = JSON.stringify({ ...payload, reason: payload.message, callStackSymbols: [] });
  for (let i = 0; i < 5; i++) await launch();
  // Before: the sources were retained and re-reported on every boot, 10 rows.
  assert.equal(native.analytics.rows.length, 2);
  assert.equal(responses.length, 0);
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
  assert.equal(native.disk.contents, null);
  const ids = native.analytics.rows.map((row: any) => row.metadata.crash_id);
  assert.equal(new Set(ids).size, 2);
});

test("Sentry rejecting every send: one analytics row per crash, and retries stop at the cap", async () => {
  status = 429;
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  for (let i = 0; i < 8; i++) await launch();
  assert.equal(native.analytics.rows.length, 1);
  assert.equal(responses.length, 5);
  // Released once the attempt budget is spent, so it is not re-read forever.
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
});

test("an analytics failure retries on the next boot, then the row is written once", async () => {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  native.analytics.fail = true;
  await launch();
  assert.ok(native.mmkv.getString(JS_KEY));
  native.analytics.fail = false;
  native.analytics.rows.length = 0;
  for (let i = 0; i < 4; i++) await launch();
  assert.equal(native.analytics.rows.length, 1);
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
});

test("a crash already acknowledged by the V2 receipt record is not sent again", async () => {
  native.mmkv.set(RECEIPTS_KEY, JSON.stringify([`${(await import(
    new URL("../../../observability/src/capture.ts", import.meta.url).href,
  )).crashSignature("js", payload)}|${payload.timestamp}`]));
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  await launch();
  assert.equal(native.analytics.rows.length, 0);
  assert.equal(responses.length, 0);
  assert.equal(native.mmkv.getString(JS_KEY), undefined);
});

test("acknowledging an older report cannot delete a new crash captured during the request", async () => {
  const pending: Array<() => void> = [];
  globalThis.fetch = () => new Promise<Response>((resolve) => {
    pending.push(() => resolve(new Response("{}", { status: 200 })));
  });
  native.mmkv.set(JS_KEY, JSON.stringify(payload));
  native.disk.contents = JSON.stringify({ ...payload, callStackSymbols: [] });
  await launch();
  assert.equal(pending.length, 2);
  const newer = { ...payload, timestamp: "2026-09-19T01:01:00.000Z", message: "another crash" };
  native.mmkv.set(JS_KEY, JSON.stringify(newer));
  native.disk.contents = JSON.stringify(newer);
  pending.forEach((resolve) => resolve());
  await settle();
  assert.equal(native.mmkv.getString(JS_KEY), JSON.stringify(newer));
  assert.equal(native.disk.contents, JSON.stringify(newer));
  assert.equal(native.disk.removals, 0);
});

test("deduplication suppresses a delivered occurrence, not later crashes with the same message", async () => {
  const mod = await launch();
  assert.equal(await mod.reportPriorCrash("js", payload), true);
  assert.equal(await mod.reportPriorCrash("js", payload), true);
  assert.equal(responses.length, 1);
  assert.equal(await mod.reportPriorCrash("js", { ...payload, timestamp: "2026-09-19T01:01:00.000Z" }), true);
  assert.equal(responses.length, 2);
});

test("failed delivery can retry in the same session; an analytics failure does not block Sentry", async () => {
  const mod = await launch();
  status = 503;
  assert.equal(await mod.reportPriorCrash("js", payload), false);
  native.analytics.fail = true;
  status = 200;
  assert.equal(await mod.reportPriorCrash("js", payload), true);
  assert.equal(responses.length, 2);
});

test("a nonfatal ErrorUtils report is not counted as a fatal crash", async () => {
  const mod = await launch();
  await mod.reportPriorCrash("js", { ...payload, isFatal: false });
  assert.equal(responses[0].level, "error");
});

test("DVNT-WEB-S: selecting dark theme on web avoids the missing Appearance API", async () => {
  native.Platform.OS = "web";
  const { useColorScheme } = await import(new URL("../hooks/use-color-scheme.ts", import.meta.url).href);
  const theme = useColorScheme();
  assert.equal(theme.colorScheme, "dark");
  assert.equal(theme.isDarkColorScheme, true);
  assert.doesNotThrow(() => theme.setColorScheme());
  assert.doesNotThrow(() => theme.toggleColorScheme());
  assert.deepEqual(native.themeCalls, []);
  native.Platform.OS = "ios";
  useColorScheme().setColorScheme();
  native.Platform.OS = "android";
  useColorScheme().toggleColorScheme();
  assert.deepEqual(native.themeCalls, ["dark", "dark"]);
});
