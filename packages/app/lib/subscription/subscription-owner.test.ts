import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { membershipOwnerKeys } from "./subscription-owner.ts";
import { membershipOwnerKeys as serverOwnerKeys } from "../../../../apps/mobile/supabase/functions/_shared/subscription-owner.ts";

const cases = [
  { name: "canonical and numeric-profile aliases", authId: "auth-a", users: [{ id: 11, auth_id: "auth-a" }], expected: ["auth-a", "11"] },
  { name: "canonical numeric auth-id collision", authId: "auth-a", users: [{ id: 11, auth_id: "auth-a" }, { id: 22, auth_id: "11" }], expected: ["auth-a"] },
  { name: "numeric auth principal remains valid", authId: "11", users: [{ id: 11, auth_id: "auth-a" }, { id: 22, auth_id: "11" }], expected: ["11", "22"] },
  { name: "same canonical and profile key deduplicates", authId: "11", users: [{ id: 11, auth_id: "11" }], expected: ["11"] },
  { name: "profile reassignment cannot retain old aliases", authId: "auth-a", users: [{ id: 11, auth_id: "auth-b" }], expected: null },
  { name: "ambiguous profile mapping denied", authId: "auth-a", users: [{ id: 11, auth_id: "auth-a" }, { id: 22, auth_id: "auth-a" }], expected: null },
];
for (const scenario of cases) test(scenario.name, async () => {
  const db = { from(table: string) { assert.equal(table, "users"); return { select() { return { async eq(key: string, value: string) {
    assert.equal(key, "auth_id");
    return { data: scenario.users.filter((u) => u.auth_id === value), error: null };
  } }; } }; } };
  for (const read of [membershipOwnerKeys, serverOwnerKeys]) {
    if (scenario.expected) assert.deepEqual(await read(db, scenario.authId), scenario.expected);
    else await assert.rejects(read(db, scenario.authId), /verify subscription identity/);
  }
});
test("client/server ownership implementations remain identical", () => {
  assert.equal(readFileSync(new URL("./subscription-owner.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../../../apps/mobile/supabase/functions/_shared/subscription-owner.ts", import.meta.url), "utf8"));
});
