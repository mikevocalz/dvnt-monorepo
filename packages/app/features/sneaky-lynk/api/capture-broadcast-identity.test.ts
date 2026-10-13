import assert from "node:assert/strict";
import { test } from "node:test";
import { captureBroadcastIdentity } from "./capture-broadcast-identity.ts";

test("anonymous capture payloads and presence keys contain neither auth id nor real username", () => {
  const identity = captureBroadcastIdentity({ id: "private-auth-id", username: "real-person", attributable: false }, "session-opaque");
  assert.deepEqual(identity, { actorId: "anon:session-opaque", actorUsername: "Someone" });
  const wire = JSON.stringify({ presence: { key: identity.actorId }, payload: identity });
  assert.ok(!wire.includes("private-auth-id"));
  assert.ok(!wire.includes("real-person"));
});

test("named capture attribution retains the published identity", () => {
  assert.deepEqual(captureBroadcastIdentity({ id: "named-user", username: "Dana", attributable: true }, "session"), { actorId: "named-user", actorUsername: "Dana" });
});

test("different anonymous sessions cannot be linked through the public capture identity", () => {
  const user = { id: "private-auth-id", username: "real-person", attributable: false };
  assert.notEqual(captureBroadcastIdentity(user, "session-one").actorId, captureBroadcastIdentity(user, "session-two").actorId);
});
