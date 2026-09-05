import { test } from "node:test";
import assert from "node:assert/strict";
import { bindMessageChanges } from "./message-realtime.ts";

test("binds edits, reactions, deletion, insertion and viewer read cursor before subscription", () => {
  const registrations: any[] = [];
  const channel = { on(type: string, filter: unknown, callback: () => void) { registrations.push({type, filter, callback}); return this; } };
  let invalidations = 0;
  assert.equal(bindMessageChanges(channel as any, "7", () => invalidations++, "9"), channel);
  assert.deepEqual(registrations.map(r => r.filter), [
    { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq.9" },
    { event: "*", schema: "public", table: "conversation_reads", filter: "user_id=eq.7" },
  ]);
  registrations[0].callback({eventType: "UPDATE"});
  registrations[1].callback({eventType: "INSERT"});
  assert.equal(invalidations, 2);
  assert.throws(() => bindMessageChanges(channel as any, "bad", () => {}));
});
