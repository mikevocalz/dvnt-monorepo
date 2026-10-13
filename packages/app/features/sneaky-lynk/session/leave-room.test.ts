import assert from "node:assert/strict";
import { test } from "node:test";
import { leaveRoomSafely } from "./leave-room.ts";
for (const mode of ["refused", "throws"] as const) {
  test(`host ${mode}: no teardown or navigation after failure`, async () => {
    let exits = 0; const errors: string[] = [];
    assert.equal(await leaveRoomSafely({ isHost:true, endRoom:async()=>{ if(mode === "throws") throw new Error("offline"); return {ok:false,error:{message:"Try again"}}; },leaveRoom:async()=>{},exit:()=>exits++,onFailure:e=>errors.push(e)}),false);
    assert.equal(exits,0); assert.equal(errors.length,1);
  });
}
test("confirmed or previously ended hosts exit once", async () => {
  for (const response of [{ok:true},{ok:false,error:{message:"Room is already ended"}}]) {
    let exits=0; assert.equal(await leaveRoomSafely({isHost:true,endRoom:async()=>response,leaveRoom:async()=>{},exit:()=>exits++,onFailure:()=>assert.fail("unexpected failure")}),true);assert.equal(exits,1);
  }
});
test("guest always releases local media even when presence leave fails", async () => {
  let exits=0;assert.equal(await leaveRoomSafely({isHost:false,endRoom:async()=>{throw new Error("must not end room")},leaveRoom:async()=>{throw new Error("offline")},exit:()=>exits++,onFailure:()=>assert.fail("guest leave must be local")}),true);assert.equal(exits,1);
});

for (const outcome of ["success", "refused", "throws"] as const) {
  test(`a stale host-end ${outcome} cannot exit or show errors in the replacement room`, async () => {
    let current = true;
    let resolve!: (value: { ok: boolean; error?: { message: string } }) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<{ ok: boolean; error?: { message: string } }>((yes, no) => { resolve = yes; reject = no; });
    let exits = 0;
    let errors = 0;
    const result = leaveRoomSafely({ isHost: true, endRoom: () => response, leaveRoom: async () => {}, isCurrent: () => current, exit: () => exits++, onFailure: () => errors++ });
    current = false;
    if (outcome === "throws") reject(new Error("Offline"));
    else resolve(outcome === "success" ? { ok: true } : { ok: false, error: { message: "Denied" } });
    assert.equal(await result, false);
    assert.equal(exits, 0);
    assert.equal(errors, 0);
  });
}

test("a confirmation from an already-unmounted room cannot start an end request", async () => {
  let calls = 0;
  assert.equal(await leaveRoomSafely({ isHost: true, isCurrent: () => false, endRoom: async () => { calls++; return { ok: true }; }, leaveRoom: async () => {}, exit: () => assert.fail("stale exit"), onFailure: () => assert.fail("stale error") }), false);
  assert.equal(calls, 0);
});
