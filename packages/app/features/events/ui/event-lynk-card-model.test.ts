import test from "node:test";
import assert from "node:assert/strict";
import { eventLynkCardModel, eventLynkWaitingLabel } from "./event-lynk-card-model.ts";
const base = {roomId:"linked-room",signedIn:true,mayHost:true,view:null,isLoading:false,isError:false,isTerminal:false,isLive:false,isOpening:false,onOpen:()=>{},onRetry:()=>{}};
test("guests and signed-out viewers cannot see host-only state or presence",()=>{
 for(const role of [{mayHost:false},{signedIn:false}]){
  const m=eventLynkCardModel({...base,...role,isLive:true,isTerminal:true,isError:true,view:{state:"live",waiting:[],count:30}});
  assert.equal(m.showRoster,false);assert.equal(m.live,false);assert.equal(m.terminal,false);assert.equal(m.error,false);assert.equal(m.badge,"Members only");
 }
});
test("only server lifecycle state produces scheduled, ready, live and ended presentation",()=>{
 assert.equal(eventLynkCardModel(base).badge,"Host access");
 for(const [state,label] of [["scheduled","Scheduled"],["ready","Ready to start"]] as const) assert.equal(eventLynkCardModel({...base,view:{state,count:0,waiting:[]}}).badge,label);
 assert.equal(eventLynkCardModel({...base,isLive:true}).action,"Enter event Lynk");
 assert.equal(eventLynkCardModel({...base,isTerminal:true}).disabled,true);
 assert.equal(eventLynkCardModel({...base,isLoading:true}).disabled,true);
 assert.equal(eventLynkCardModel({...base,isOpening:true}).disabled,true);
});
test("waiting copy handles empty, one and a crowd without admission promises",()=>{
 assert.equal(eventLynkWaitingLabel(0),"No one waiting yet");assert.equal(eventLynkWaitingLabel(1),"1 person waiting");assert.equal(eventLynkWaitingLabel(30),"30 people waiting");
 assert.match(eventLynkCardModel(base).guidance,/available space/);
 assert.match(eventLynkCardModel({...base,mayHost:false}).guidance,/verification/);
});
