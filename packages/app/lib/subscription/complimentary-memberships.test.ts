import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { fetchSubscriptionRecords, entitlementReadSnapshot, nextEntitlementBoundary } from "./subscription-records.ts";
import { billingSummary } from "./billing-summary.ts";
import { readLynkSubscription } from "../../../../apps/mobile/supabase/functions/_shared/lynk-subscription.ts";
const NOW=new Date("2026-10-13T12:00:00Z");
const FUTURE="2026-10-14T12:00:00Z";
const grant={user_id:"member-auth",product_family:"dvnt_membership",plan_key:"dvnt_vip",status:"active",rail:null,source:"complimentary",current_period_end:null};
const paid={user_id:"member-auth",product_family:"dvnt_membership",plan_key:"dvnt_core",status:"active",rail:"web_stripe",current_period_end:FUTURE,stripe_subscription_id:"fixture-paid-sub"};
function fixture(overrides: Record<string, unknown[]>={}) {
  const tables: Record<string, any[]>={users:[{id:2,auth_id:"member-auth"}],membership_subscriptions:[],sneaky_subscriptions:[],membership_grant_records:[grant],...overrides};
  return {from(table:string) {assert.ok(Object.hasOwn(tables,table));return {select() {
    const read=async(key:string,value:string|string[])=>({data:tables[table].filter(row=>(Array.isArray(value)?value:[value]).includes(String(row[key]))),error:null});
    return {eq:read,in:read};
  }}}};
}

test("non-expiring comp VIP uses the existing badge entitlement and full VIP room capabilities",async()=>{
  const client=fixture();const records=await fetchSubscriptionRecords(client,"member-auth");
  const {entitlements}=entitlementReadSnapshot(records,"ready",NOW);
  assert.equal(entitlements.planKey,"dvnt_vip");assert.equal(entitlements.memberBadge,true);
  assert.equal(entitlements.maxParticipants,50);assert.equal(entitlements.sessionMinutes,null);
  assert.equal(nextEntitlementBoundary(records,NOW.getTime()),null);
  assert.equal(records[0].source,"complimentary");assert.equal(records[0].rail,null);
  const summary=billingSummary(records,entitlements,NOW);
  assert.equal(summary.isComplimentary,true);assert.equal(summary.planInfo.price,"Complimentary");
  assert.equal(summary.canManageStripe,false);assert.equal(summary.canCheckoutStandalone,false);
  assert.equal((await readLynkSubscription(client,"member-auth",NOW.getTime())).planKey,"dvnt_vip");
});

test("higher paid tiers win; lower paid records retain their billing management while VIP is granted",async()=>{
  for(const plan of ["dvnt_core","dvnt_founders_circle"]) {
    const records=await fetchSubscriptionRecords(fixture({membership_subscriptions:[{...paid,plan_key:plan}]}),"member-auth");
    const {entitlements}=entitlementReadSnapshot(records,"ready",NOW);
    const expected=plan==="dvnt_core"?"dvnt_vip":"dvnt_founders_circle";
    assert.equal(entitlements.planKey,expected);
    assert.equal(records[0].stripeSubscriptionId,"fixture-paid-sub");
    const summary=billingSummary(records,entitlements,NOW);
    assert.equal(summary.canManageStripe,true);assert.equal(summary.isComplimentary,plan==="dvnt_core");
    assert.equal((await readLynkSubscription(fixture({membership_subscriptions:[{...paid,plan_key:plan}]}),"member-auth",NOW.getTime())).planKey,expected);
  }
});

test("revocation and exact expiry drop a grant without changing the paid fallback",async()=>{
  for(const changed of [{...grant,status:"inactive"},{...grant,current_period_end:NOW.toISOString()}]) {
    const client=fixture({membership_subscriptions:[paid],membership_grant_records:[changed]});
    const records=await fetchSubscriptionRecords(client,"member-auth");
    assert.equal(entitlementReadSnapshot(records,"ready",NOW).entitlements.planKey,"dvnt_core");
    assert.equal((await readLynkSubscription(client,"member-auth",NOW.getTime())).planKey,"dvnt_core");
  }
});

test("existing membership screens label complimentary access and do not sell covered lower tiers",()=>{
  for(const file of ["MembershipScreen.tsx","MembershipScreen.native.tsx"]) {
    const source=readFileSync(new URL(`../../features/screens/membership/${file}`,import.meta.url),"utf8");
    assert.match(source,/isComplimentary/);assert.match(source,/"Complimentary"/);
    assert.match(source,/PLAN_RANK\[key\] > PLAN_RANK\[currentKey\]/);
    assert.match(source,/Could not verify your membership/);
  }
  const source=readFileSync(new URL("./use-badge-tier.ts",import.meta.url),"utf8");
  assert.match(source,/refetchInterval: 30_000/);assert.match(source,/query.isError \? null/);
});
