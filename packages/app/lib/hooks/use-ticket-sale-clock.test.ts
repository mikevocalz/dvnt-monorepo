import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = fs.readFileSync(new URL("./use-ticket-sale-clock.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness() {
  let now = Date.parse("2026-11-06T08:00:00Z");
  let refreshes = 0;
  let cleanup: (() => void) | undefined;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let id = 0;
  const exports: any = {};
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(code, { exports, Date: Clock, require: () => ({ useReducer: () => [0, () => refreshes++], useEffect: (effect: () => any) => { cleanup?.(); cleanup = effect(); } }), setTimeout: (callback: () => void, delay: number) => { timers.set(++id, { callback, delay }); return id; }, clearTimeout: (timer: number) => timers.delete(timer) });
  return { hook: exports.useTicketSaleClock, timers, get now() { return now; }, get refreshes() { return refreshes; }, advance(ms: number) { now += ms; }, unmount() { cleanup?.(); } };
}

test("clock refreshes once at next opening, then schedules the following tier", () => {
  const h = harness();
  const tiers = [10, 50].map(ms => ({ sale_start: new Date(h.now + ms).toISOString() }));
  assert.equal(h.hook(tiers), h.now);
  assert.equal([...h.timers.values()][0].delay, 10);
  h.advance(10);
  [...h.timers.values()][0].callback();
  assert.equal(h.refreshes, 1);
  h.hook(tiers);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 40);
  h.advance(100); // a suspended app resumes after both openings
  [...h.timers.values()][0].callback();
  h.hook(tiers);
  assert.equal(h.timers.size, 0);
});

test("navigation/unmount cancels pending timer, and long waits cannot overflow", () => {
  const h = harness();
  h.hook([{ sale_start: "2099-01-01T00:00:00Z" }]);
  assert.equal([...h.timers.values()][0].delay, 86_400_000);
  h.hook([]);
  assert.equal(h.timers.size, 0);
  h.hook([{ sale_start: "2099-01-01T00:00:00Z" }]);
  h.unmount();
  assert.equal(h.timers.size, 0);
});
