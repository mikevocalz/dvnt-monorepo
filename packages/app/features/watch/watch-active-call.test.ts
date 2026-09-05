import test from "node:test";
import assert from "node:assert/strict";
import { microphoneMatches, activeCallPhase, validateActiveCallCommand } from "./watch-active-call";
test("connected requires actual peer transport and remote participant, never signaling alone", () => {
  assert.equal(activeCallPhase(false, "connecting", "connected", 1), "connecting");
  assert.equal(activeCallPhase(false, "connected", "connected", 0), "connecting");
  assert.equal(activeCallPhase(false, "connected", "outgoing_ringing", 0), "ringing");
  assert.equal(activeCallPhase(false, "connected", "connected", 1), "connected");
  assert.equal(activeCallPhase(false, "connected", "starting_media", 1), "connecting");
  assert.equal(activeCallPhase(true, "connected", "connected", 1), "ended");
});
test("active commands bind room/account/TTL and desired mute state", () => {
  const command = { protocol:2, accountGen:"A", operationId:"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", type:"activeCallAction", roomId:"room", expectedStatus:"connected", action:"set_muted", muted:true, issuedAt:100, expiresAt:130 };
  assert.ok(validateActiveCallCommand(command,"A","room",101));
  assert.equal(validateActiveCallCommand(command,"B","room",101),null);
  assert.equal(validateActiveCallCommand(command,"A","other",101),null);
  assert.equal(validateActiveCallCommand(command,"A","room",130),null);
  assert.equal(validateActiveCallCommand({...command,muted:undefined},"A","room",101),null);
});

test("mute confirmation requires live nonempty tracks with the desired state", () => {
  assert.equal(microphoneMatches([], false), false);
  assert.equal(microphoneMatches([{enabled:false,readyState:"ended"}], false), false);
  assert.equal(microphoneMatches([{enabled:true,readyState:"live"}], false), false);
  assert.equal(microphoneMatches([{enabled:false,readyState:"live"}], false), true);
});
