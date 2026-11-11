import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const input = { eventId: 42, code: " cohost15 ", discountType: "percent", discountValue: 15, maxUses: null };
function fixture(response: any) {
  const exports: any = {};
  const calls: any[] = [];
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./promo-codes.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => ({ invokeEdge: async (...args: any[]) => { calls.push(args); return response; } }) });
  return { create: exports.createEventPromoCode, calls };
}

test("shared native/web creator sends an authenticated server command, not a direct table insert", async () => {
  const f = fixture({ data: { ok: true, promo: { id: "promo", code: "COHOST15" } } });
  assert.equal(await f.create(input), "COHOST15");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [["manage-promo-code", {
    action: "create", event_id: 42, code: "COHOST15", discount_type: "percent", discount_value: 15, max_uses: null,
  }]]);
});

test("duplicate, refusal, offline and malformed success responses never claim a code was created", async () => {
  for (const response of [
    { error: { status: 403, message: "Not an accepted editor" } },
    { error: { message: "Network error" } }, { data: { ok: true } }, { data: { ok: false } },
  ]) await assert.rejects(fixture(response).create(input));
  const f = fixture({ error: { status: 409, message: "This code already exists" } });
  await assert.rejects(f.create(input), (error: any) => error.duplicate === true);
});

test("both promo screens use the shared role-authorized creator without a client bridge insert", () => {
  for (const file of ["../../features/events/promo-codes.web.tsx", "../../features/routes/screens/(protected)/events/[id]/promo-codes.tsx"]) {
    const source=fs.readFileSync(new URL(file,import.meta.url),"utf8");
    assert.match(source,/await createEventPromoCode\(/);
    assert.doesNotMatch(source,/supabase\.from\("promo_codes"\)\.insert/);
    assert.doesNotMatch(source,/created_by: authId/);
  }
});
