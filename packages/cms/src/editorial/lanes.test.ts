import test from "node:test";
import assert from "node:assert/strict";
import {DVNT_EDITORIAL_CHANNELS,EDITORIAL_DISCLOSURE,canAutoEngageEditorial,canPublishEditorial} from "./lanes.ts";
test("exactly the ten historically approved editorial lanes are enumerated",()=>{
 assert.equal(DVNT_EDITORIAL_CHANNELS.length,10);
 assert.equal(new Set(DVNT_EDITORIAL_CHANNELS.map(l=>l.slug)).size,10);
 assert.ok(DVNT_EDITORIAL_CHANNELS.some(l=>l.slug==="black-queer-history"));
 assert.ok(DVNT_EDITORIAL_CHANNELS.some(l=>l.slug==="cars-architecture-travel"));
 assert.match(EDITORIAL_DISCLOSURE,/Editorial/);
});
test("publishing is never enabled just because a channel is enabled",()=>{
 const allowed={stage:"scheduled" as const,hasApprovedModerator:true,hasProvenance:true,agePolicyCleared:true,channelEnabled:true,publishAt:"2026-10-21T19:00:00Z"};
 assert.equal(canPublishEditorial(allowed),true);
 for(const key of ["hasApprovedModerator","hasProvenance","agePolicyCleared","channelEnabled"] as const)
   assert.equal(canPublishEditorial({...allowed,[key]:false}),false,key);
 assert.equal(canPublishEditorial({...allowed,stage:"draft"}),false);
 assert.equal(canPublishEditorial({...allowed,publishAt:null}),false);
});
test("editorial auto-engagement stays hard disabled until explicit controls exist",()=>{
 for(const p of DVNT_EDITORIAL_CHANNELS) assert.equal(canAutoEngageEditorial(p.slug),false);
});
