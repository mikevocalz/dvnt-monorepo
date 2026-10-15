import test from "node:test";
import assert from "node:assert/strict";
import {decideTipDraft} from "./tip-intent-policy.ts";
const p={processorApproved:true,verifiedAdult:true,inLiveRoom:true,creatorPayoutsEnabled:true,minCents:100,maxCents:10000};
const d={amountCents:500,recipientHandle:"member:41",operationId:"tip_unique_123456"};
test("no processor approval means no tips",()=>assert.equal(decideTipDraft({...p,processorApproved:false},d).allowed,false));
test("nonmember or unverified users cannot pay",()=>{
 assert.equal(decideTipDraft({...p,inLiveRoom:false},d).allowed,false);
 assert.equal(decideTipDraft({...p,verifiedAdult:false},d).allowed,false);
});
test("unready recipient cannot receive tip",()=>assert.equal(decideTipDraft({...p,creatorPayoutsEnabled:false},d).allowed,false));
test("integer bounds and operation IDs are mandatory",()=>{
 assert.equal(decideTipDraft(p,{...d,amountCents:12.5}).allowed,false);
 assert.equal(decideTipDraft(p,{...d,amountCents:0}).allowed,false);
 assert.equal(decideTipDraft(p,{...d,amountCents:10001}).allowed,false);
 assert.equal(decideTipDraft(p,{...d,operationId:""}).allowed,false);
 assert.equal(decideTipDraft(p,d).allowed,true);
});
