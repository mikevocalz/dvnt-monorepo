import test from "node:test";
import assert from "node:assert/strict";
import { validateCallDirectoryCommand } from "./watch-call-directory";
const base = { protocol: 2, accountGen: "A", operationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type: "callDirectoryAction", action: "start_on_phone", participantIds: ["1"], callType: "audio", issuedAt: 100, expiresAt: 130 };
test("one to three recipients, independent from conversation group size", () => {
  for (const count of [1,2,3]) assert.ok(validateCallDirectoryCommand({ ...base, participantIds: Array.from({length:count}, (_,i) => String(i+1)) }, "A", 101));
  for (const participantIds of [[], ["1","2","3","4"], ["1","1"], ["auth-id"], ["0"], ["9007199254740993"]]) assert.equal(validateCallDirectoryCommand({ ...base, participantIds }, "A", 101), null);
});
test("commands reject old account, expired, invalid type and unbounded search", () => {
  assert.equal(validateCallDirectoryCommand(base, "B", 101), null);
  assert.equal(validateCallDirectoryCommand(base, "A", 130), null);
  assert.equal(validateCallDirectoryCommand({ ...base, callType: "native" }, "A", 101), null);
  assert.equal(validateCallDirectoryCommand({ ...base, action: "search", query: "x".repeat(61) }, "A", 101), null);
  assert.ok(validateCallDirectoryCommand({ ...base, action: "search", query: "alice" }, "A", 101));
});
