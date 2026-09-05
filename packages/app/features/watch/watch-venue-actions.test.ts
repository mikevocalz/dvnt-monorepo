import test from "node:test";
import assert from "node:assert/strict";
import { executeVenueCommand, validateVenueCommand, type VenueOperation, type WatchVenueCommand } from "./watch-venue-actions";
import { presenceExpiry } from "../../../../apps/mobile/supabase/functions/_shared/presence-expiry";
const command: WatchVenueCommand = { protocol: 2, accountGen: "A", operationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type: "venueAction", eventId: "1", action: "notice", body: "Doors open", audience: "all", issuedAt: 100, expiresAt: 160 };
test("venue limits, scope, expiry and state words", () => {
  assert.ok(validateVenueCommand(command, "A", 101));
  for (const change of [{ accountGen: "B" }, { expiresAt: 161 }, { body: "x".repeat(401) }, { audience: "invented" }, { lat: 10 }, { intent: "urgent" }]) assert.equal(validateVenueCommand({ ...command, ...change }, "A", 101), null);
  assert.equal(validateVenueCommand(command, "A", 160), null);
  const { body, audience, ...base } = command;
  for (const state of ["approaching", "arrived", "departed", "revoke"]) assert.ok(validateVenueCommand({ ...base, action: "presence", ticketId: "self", state }, "A", 101));
  assert.equal(validateVenueCommand({ ...base, action: "presence", ticketId: "self", state: "late" }, "A", 101), null);
});
test("durable pending blocks duplicate notice after simulated restart; unknown never repeats", async () => {
  let persisted: Record<string, VenueOperation> = {}; let writes = 0;
  const io = { get: (id: string) => persisted[id], put: (id: string, value: VenueOperation) => { persisted[id] = JSON.parse(JSON.stringify(value)); }, assertCurrent: () => {}, write: async () => { writes++; throw new Error("response lost"); } };
  assert.equal((await executeVenueCommand(command, io)).status, "uncertain");
  assert.equal((await executeVenueCommand(command, { ...io, get: id => JSON.parse(JSON.stringify(persisted))[id] })).status, "uncertain");
  assert.equal(writes, 1);
  delete persisted[command.operationId].result;
  assert.equal((await executeVenueCommand(command, io)).status, "uncertain");
  assert.equal(writes, 1);
  assert.equal((await executeVenueCommand({ ...command, body: "changed" }, io)).status, "rejected");
});
test("only backend confirmation succeeds; stale account cannot write result", async () => {
  const entries: Record<string, VenueOperation> = {}; let current = true;
  const io = { get: (id: string) => entries[id], put: (id: string, value: VenueOperation) => { entries[id] = value; }, assertCurrent: () => { if (!current) throw Error("changed"); }, write: async () => ({ confirmed: true, message: "No attendees matched this audience" }) };
  assert.equal((await executeVenueCommand(command, io)).message, "No attendees matched this audience");
  const next = { ...command, operationId: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" };
  await executeVenueCommand(next, { ...io, write: async () => { current = false; return { confirmed: true }; } });
  assert.equal(entries[next.operationId].result, undefined);
});
test("presence expiry follows real end date, otherwise six hours not twelve", () => {
  assert.equal(presenceExpiry(undefined, 0), "1970-01-01T06:00:00.000Z");
  assert.equal(presenceExpiry("invalid", 0), "1970-01-01T06:00:00.000Z");
  assert.equal(presenceExpiry("1970-01-02T00:00:00Z", 0), "1970-01-02T06:00:00.000Z");
});
