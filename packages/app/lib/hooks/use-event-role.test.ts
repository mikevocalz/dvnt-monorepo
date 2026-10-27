import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function hookFixture(query: any) {
  let options: any;
  const exports: any = {};
  const code = ts.transpileModule(fs.readFileSync(new URL("./use-event-role.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@tanstack/react-query"
    ? { useQuery: (o: any) => { options = o; return query; } }
    : name.endsWith("auth-store") ? { useAuthStore: (f: any) => f({ user: { id: "staff-2" }, isAuthenticated: true }) }
    : name.endsWith("stale-time-config") ? { GC_TIMES: { standard: 1000 } } : {},
  });
  return { result: exports.useEventRole("7"), get options() { return options; } };
}
test("initial offline pause is pending, not a confirmed no-role decision", () => {
  const f = hookFixture({ data: undefined, isLoading: false, isPending: true, fetchStatus: "paused", isError: false, isSuccess: false });
  assert.equal(f.result.isPending, true); assert.equal(f.result.isPaused, true); assert.equal(f.result.hasResolved, false);
  assert.deepEqual(Array.from(f.options.queryKey), ["event-role", "staff-2", "7"]);
});
test("explicit authorization errors survive hook boundary even with stale cached role", () => {
  for (const status of [401, 403, 503]) {
    const f = hookFixture({ data: "scanner", isLoading: false, isPending: false, fetchStatus: "idle", isError: true, isSuccess: false, error: { status } });
    assert.equal(f.result.errorStatus, status); assert.equal(f.result.hasResolved, false);
  }
});
