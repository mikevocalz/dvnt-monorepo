import test from "node:test";
import assert from "node:assert/strict";
import {canActivateCreatorOffer} from "./offer-policy.ts";
const valid={
 enabled:true,signedApprovalRef:"approval:1",approvedBy:"authorized-operator",
 processorApprovalRef:"processor:approved",compensationPlanId:"versioned-plan",
 startsAt:"2026-10-20T12:00:00Z",endsAt:"2026-10-27T12:00:00Z",
 maxRedemptions:100,currentlyRedeemed:0,
};
test("creator offers are inert without explicit signed owner and processor approvals",()=>{
 for(const field of ["enabled","signedApprovalRef","approvedBy","processorApprovalRef","compensationPlanId"] as const){
  assert.equal(canActivateCreatorOffer({...valid,[field]:field==="enabled"?false:null}),false,field);
 }
});
test("campaign and budget must be finite and bounded",()=>{
 assert.equal(canActivateCreatorOffer(valid),true);
 assert.equal(canActivateCreatorOffer({...valid,endsAt:valid.startsAt}),false);
 assert.equal(canActivateCreatorOffer({...valid,maxRedemptions:0}),false);
 assert.equal(canActivateCreatorOffer({...valid,currentlyRedeemed:100}),false);
 assert.equal(canActivateCreatorOffer({...valid,currentlyRedeemed:-1}),false);
});
