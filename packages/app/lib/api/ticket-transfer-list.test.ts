import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function fixture(results: any[], authId: string | null = "owner") {
  let reads = 0;
  const supabase = {
    from: () => {
      const result = results[reads++];
      const query: any = {};
      for (const method of ["select", "eq", "gt"]) query[method] = () => query;
      query.order = async () => {
        if (result instanceof Error) throw result;
        return result;
      };
      return query;
    },
  };
  const exports: any = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL("./tickets.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    console: { error() {} },
    require: (name: string) =>
      name === "../supabase/client"
        ? { supabase }
        : name === "./auth-helper"
          ? { getCurrentUserAuthId: async () => authId }
          : {},
  });
  return exports.ticketsApi;
}
for (const direction of ["incoming", "outgoing"]) {
  test(`${direction} read refusal is not a successful empty inbox`, async () => {
    const ok = { data: [], error: null },
      bad = { data: null, error: { message: "internal SQL detail" } };
    await assert.rejects(
      fixture(
        direction === "incoming" ? [bad] : [ok, bad],
      ).getPendingTransfers(),
      /Could not load ticket transfers/,
    );
  });
}
test("transport exception is actionable but does not leak internals", async () => {
  await assert.rejects(
    fixture([new Error("secret proxy URL")]).getPendingTransfers(),
    /Could not load ticket transfers/,
  );
});
test("successful empty lists and transfers remain intact", async () => {
  const api = fixture([
    { data: [{ id: "incoming" }], error: null },
    { data: [{ id: "outgoing" }], error: null },
  ]);
  const result = await api.getPendingTransfers();
  assert.equal(result.incoming[0].id, "incoming");
  assert.equal(result.outgoing[0].id, "outgoing");
  const empty = await fixture([
    { data: [], error: null },
    { data: [], error: null },
  ]).getPendingTransfers();
  assert.equal(empty.incoming.length, 0);
  assert.equal(empty.outgoing.length, 0);
});

test("missing session cannot masquerade as an empty signed-in inbox", async () => {
  await assert.rejects(
    fixture([], null).getPendingTransfers(),
    /Could not load ticket transfers/,
  );
});
