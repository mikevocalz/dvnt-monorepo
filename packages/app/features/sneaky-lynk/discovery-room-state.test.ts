import test from "node:test";
import assert from "node:assert/strict";
import { bindDiscoveryRoom, discoveryRoomState } from "./discovery-room-state.ts";
const now = Date.parse("2026-11-07T00:00:00Z"), mono = 1000;
const base = { status: "open" as const, isLive: true, availability: "live" as const,
  presenceKnown: true, observedAt: new Date(now).toISOString(), presenceExpiresAt: new Date(now + 90_000).toISOString(),
  requestStartedAt: now, requestStartedMonotonic: mono, listeners: 10, maxParticipants: 10 };
const state = (room: typeof base, elapsed = 0) => discoveryRoomState(room, now + elapsed, mono + elapsed);
test("only fresh known live proof permits joining, including full rooms", () => {
  const room = bindDiscoveryRoom(base, () => true);
  assert.equal(state(room).live, true); assert.equal(state(room).full, true); assert.equal(state(room).actionLabel, "Check room");
  assert.equal(state(room, 90_000).actionable, false);
});
test("raw open, unknown presence, missing observations and persisted copies never prove live", () => {
  assert.equal(state(base).live, false);
  for (const fields of [{presenceKnown:false}, {availability:"unknown"}, {observedAt:undefined}, {presenceExpiresAt:undefined}, {requestStartedAt:undefined}, {requestStartedMonotonic:undefined}]) {
    const room = bindDiscoveryRoom({...base,...fields} as typeof base, () => true);
    assert.equal(state(room).live,false);
  }
  assert.equal(state(JSON.parse(JSON.stringify(bindDiscoveryRoom(base,()=>true)))).live,false);
});
test("request transit consumes lease, capped at ninety seconds; server clock offsets do not", () => {
  assert.equal(state(bindDiscoveryRoom(base,()=>true),90_001).live,false);
  const shifted = {...base,observedAt:new Date(now+3600_000).toISOString(),presenceExpiresAt:new Date(now+3690_000).toISOString(),endsAt:new Date(now+3700_000).toISOString()};
  assert.equal(state(bindDiscoveryRoom(shifted,()=>true),89_999).live,true);
  assert.equal(state(bindDiscoveryRoom({...base,presenceExpiresAt:new Date(now+999_999).toISOString()},()=>true),90_000).live,false);
});
test("monotonic elapsed expires presence and deadline despite a backwards wall clock", () => {
  const room=bindDiscoveryRoom({...base,endsAt:new Date(now+90_000).toISOString()},()=>true);
  assert.equal(discoveryRoomState(room,now-3600_000,mono+90_000).ended,true);
  assert.equal(discoveryRoomState(room,now,mono).live,false);
});
test("forward then backward wall clocks never revive live, owner or deadline proofs, including rebinding", () => {
  const source={...base,isOwner:true,endsAt:new Date(now+100_000).toISOString()};
  const first=bindDiscoveryRoom(source,()=>true);
  assert.equal(discoveryRoomState(first,now+100_000,mono).ended,true);
  const rebound=bindDiscoveryRoom(source,()=>true);
  assert.equal(discoveryRoomState(rebound,now,mono).actionable,false);
});
test("owner and live observation expiry are separate and each latches", () => {
  const room=bindDiscoveryRoom({...base,isOwner:true,presenceExpiresAt:new Date(now+10_000).toISOString()},()=>true);
  assert.equal(state(room,10_000).live,false); assert.equal(state(room,10_000).actionLabel,"Resume");
  assert.equal(discoveryRoomState(room,now,mono).live,false);
  assert.equal(state(room,90_000).canResume,false);
  assert.equal(discoveryRoomState(room,now,mono).actionable,false);
});
test("only fresh current server ownership permits Resume; invites wait without Join", () => {
  let current=true;
  const owner=bindDiscoveryRoom({...base,isLive:false,availability:"inactive",isOwner:true},()=>current);
  assert.equal(discoveryRoomState(owner,now,mono).actionLabel,"Resume");
  current=false;assert.equal(discoveryRoomState(owner,now,mono).actionable,false);
  const invite=bindDiscoveryRoom({...base,isLive:false,availability:"inactive",isInvited:true},()=>true);
  assert.equal(discoveryRoomState(invite,now,mono).label,"Waiting for host");
  assert.equal(discoveryRoomState(invite,now,mono).actionable,false);
  const unknown=bindDiscoveryRoom({...base,availability:"unknown",isOwner:true},()=>true);
  assert.equal(discoveryRoomState(unknown,now,mono).canResume,false);
});
