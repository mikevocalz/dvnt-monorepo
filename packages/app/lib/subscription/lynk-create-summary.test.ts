import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lynkCreateSummary } from "./lynk-create-summary.ts";
import { resolveEntitlementsForUser } from "./entitlements.ts";
import { PLANS } from "./plans.ts";
import type { RailedSubscriptionRecord } from "./subscription-records.ts";
const now=new Date('2026-10-14T00:00:00Z');
function present(records: RailedSubscriptionRecord[], isLoading=false,isError=false){return lynkCreateSummary({entitlements:resolveEntitlementsForUser(records,now),isLoading,isError});}
function vip(extra:Partial<RailedSubscriptionRecord>={}):RailedSubscriptionRecord{return {productFamily:'dvnt_membership',planKey:'dvnt_vip',status:'active',currentPeriodEnd:null,source:'complimentary',...extra};}
test('permanent comp VIP shows included benefits without an upsell',()=>{
 const value=present([vip()]);assert.equal(value.title,'VIP · Lynk included');assert.match(value.description,/No additional Lynk subscription/);assert.deepEqual(value.benefits,['Unlimited session duration','Up to 50 people per room','No monthly hosting limit']);assert.doesNotMatch(JSON.stringify(value),/\$|Upgrade|Unlimited screens/);
});
test('paid Stripe, iOS and Play memberships use the same coverage',()=>{
 for(const rail of ['web_stripe','ios_iap','play_iap'] as const){assert.equal(present([vip({source:undefined,rail})]).title,'VIP · Lynk included');}
});
test('every active plan reads participant and duration limits from the canonical resolver',()=>{
 for(const plan of Object.values(PLANS)){const value=present([{productFamily:plan.family,planKey:plan.key,status:'active'}]);assert.ok(value.benefits.includes(`Up to ${plan.entitlements.maxParticipants} people per room`));assert.doesNotMatch(JSON.stringify(value),/\$15|\$25|Unlimited screens/);}
});
test('pending and failed reads never advertise a free downgrade or upgrade',()=>{
 for(const value of [present([],true),present([],false,true)]){assert.equal(value.title,'Your Lynk benefits');assert.deepEqual(value.benefits,[]);assert.doesNotMatch(JSON.stringify(value),/Free Lynk|subscription is needed|\$/);}
});
test('expired grants fall back to free while paid Founders wins over VIP',()=>{
 assert.equal(present([vip({currentPeriodEnd:'2026-10-01T00:00:00Z'})]).title,'Free Lynk access');
 assert.match(present([vip(),vip({planKey:'dvnt_founders_circle',source:undefined,rail:'web_stripe'})]).title,/Founders/);
});
test('web and native create screens render the shared membership summary, never legacy prices',()=>{
 for(const rel of ['../../features/sneaky-lynk/screens/create.web.tsx','../../features/routes/screens/(protected)/sneaky-lynk/create.tsx']){
 const s=readFileSync(new URL(rel,import.meta.url),'utf8');assert.match(s,/lynkCreateSummary\(useEntitlements\(\)\)/);assert.match(s,/membership\.title/);assert.match(s,/membership\.benefits\.map/);assert.doesNotMatch(s,/\$15 \/ mo|\$25 \/ mo|Unlimited screens|Up to 15 screens/);
 }
});
