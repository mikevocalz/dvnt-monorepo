import test from "node:test";
import assert from "node:assert/strict";
import { answerIncomingCall } from "./answer-call";
import type { CallSignal } from "@dvnt/app/lib/api/call-signals";
const signal = (): CallSignal => ({id:1,room_id:"room",caller_id:"1",callee_id:"2",caller_username:"Caller",caller_avatar:null,status:"ringing",is_group:false,call_type:"audio",created_at:new Date().toISOString()});
test("missing stale foreign unsupported signals never claim or permit navigation", async () => {
  for (const row of [null, {...signal(),created_at:new Date(Date.now()-31_000).toISOString()}, {...signal(),callee_id:"3"}, {...signal(),room_id:"other"}, {...signal(),status:"ended"}, {...signal(),call_type:undefined}]) {
    let claims = 0;
    const result = await answerIncomingCall({roomId:"room",calleeId:"2",current:()=>true,fetchSignal:async()=>row as CallSignal|null,claim:async()=>{claims++;return true;}});
    assert.equal(result,null); assert.equal(claims,0);
  }
});
test("conditional claim and explicit server call type gate navigation", async () => {
  const options = {roomId:"room",calleeId:"2",current:()=>true,fetchSignal:async()=>signal(),claim:async()=>false};
  assert.equal(await answerIncomingCall(options),null);
  const accepted = await answerIncomingCall({...options,claim:async(id,callee,room)=>{assert.deepEqual([id,callee,room],[1,"2","room"]);return true;}});
  assert.equal(accepted?.status,"accepted"); assert.equal(accepted?.call_type,"audio");
});
test("account switch or hangup at either await cancels navigation; network failure fails closed", async () => {
  let current = true; let claims = 0;
  assert.equal(await answerIncomingCall({roomId:"room",calleeId:"2",current:()=>current,fetchSignal:async()=>{current=false;return signal();},claim:async()=>{claims++;return true;}}),null);
  assert.equal(claims,0);
  current=true;
  assert.equal(await answerIncomingCall({roomId:"room",calleeId:"2",current:()=>current,fetchSignal:async()=>signal(),claim:async()=>{current=false;return true;}}),null);
  assert.equal(await answerIncomingCall({roomId:"room",calleeId:"2",current:()=>true,fetchSignal:async()=>{throw Error("offline");},claim:async()=>true}),null);
});

test("decline result is confirmed only after conditional decline succeeds", async () => {
  const result = await answerIncomingCall({roomId:"room",calleeId:"2",decision:"declined",current:()=>true,fetchSignal:async()=>signal(),claim:async()=>true});
  assert.equal(result?.status,"declined");
  assert.equal(await answerIncomingCall({roomId:"room",calleeId:"2",decision:"declined",current:()=>true,fetchSignal:async()=>signal(),claim:async()=>false}),null);
});
