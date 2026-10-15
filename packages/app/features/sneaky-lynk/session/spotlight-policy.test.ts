import test from "node:test";
import assert from "node:assert/strict";
import {applyServerSpotlight,requestSpotlight,isValidSpotlightHandle} from "./spotlight-policy.ts";
import {canOfferScreenShare} from "./screen-share-capabilities.ts";
test("only active hosts or cohosts can change a room-wide spotlight",()=>{
  assert.equal(requestSpotlight({role:"host",status:"active"},{type:"set",participantHandle:"member:71"}).accepted,true);
  assert.equal(requestSpotlight({role:"co-host",status:"active"},{type:"clear"}).accepted,true);
  for(const role of ["speaker","listener","participant"] as const){
    assert.equal(requestSpotlight({role,status:"active"},{type:"clear"}).accepted,false);
  }
  assert.equal(requestSpotlight({role:"host",status:"kicked"},{type:"clear"}).accepted,false);
});
test("anonymous opaque handles must not be resolved or guessed by clients",()=>{
  assert.equal(isValidSpotlightHandle("member:41"),true);
  assert.equal(isValidSpotlightHandle("member:0"),false);
  assert.equal(isValidSpotlightHandle("member:42x"),false);
  assert.equal(isValidSpotlightHandle(""),false);
});
test("stale-room and out-of-order events never steal the spotlight",()=>{
  const base={roomId:"r1",participantHandle:"member:10",revision:5};
  assert.equal(applyServerSpotlight(base,{roomId:"r2",participantHandle:"member:11",revision:10}),base);
  assert.equal(applyServerSpotlight(base,{roomId:"r1",participantHandle:"member:11",revision:4}),base);
  assert.deepEqual(applyServerSpotlight(base,{roomId:"r1",participantHandle:null,revision:6}),{roomId:"r1",participantHandle:null,revision:6});
});
test("share control stays unavailable without real capture, publish and permission",()=>{
  const allowed={platform:"web" as const,isVerifiedAdult:true,hasActiveRoomMembership:true,role:"host" as const,roomAllowsSharing:true,captureSupported:true,publishSupported:true};
  assert.equal(canOfferScreenShare(allowed),true);
  for(const key of ["isVerifiedAdult","hasActiveRoomMembership","roomAllowsSharing","captureSupported","publishSupported"] as const){
    assert.equal(canOfferScreenShare({...allowed,[key]:false}),false,key);
  }
  assert.equal(canOfferScreenShare({...allowed,role:"listener"}),false);
});
