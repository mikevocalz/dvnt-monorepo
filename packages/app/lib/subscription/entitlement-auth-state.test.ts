import assert from 'node:assert/strict';
import test from 'node:test';
import { entitlementAuthState, readAuthenticatedEntitlements } from './entitlement-auth-state.ts';
import { entitlementReadSnapshot } from './subscription-records.ts';
import { lynkCreateSummary } from './lynk-create-summary.ts';
const restored = { platform:'web', authStatus:'loading' as const, hasHydrated:true, isAuthenticated:true, userId:'auth-test' };
test('returning web login enables the query without native boot authStatus', () => {
  assert.deepEqual(entitlementAuthState(restored), {loading:false,enabled:true,identityError:false});
  assert.equal(entitlementAuthState({...restored,hasHydrated:false}).enabled,false);
  assert.equal(entitlementAuthState({...restored,platform:'ios'}).enabled,false);
  assert.equal(entitlementAuthState({...restored,platform:'android'}).loading,true);
});
test('signed-out and missing identities never start a membership lookup', () => {
  assert.equal(entitlementAuthState({...restored,isAuthenticated:false}).enabled,false);
  assert.equal(entitlementAuthState({...restored,authStatus:'unauthenticated'}).enabled,false);
  assert.deepEqual(entitlementAuthState({...restored,userId:null}), {loading:false,enabled:false,identityError:true});
  assert.equal(entitlementAuthState({...restored,platform:'ios',authStatus:'authenticated'}).enabled,true);
});
test('restored web session resolves permanent VIP only after authenticated read', async () => {
  const calls:string[]=[];
  const records = await readAuthenticatedEntitlements({
    ensureAuthenticated:async()=>{calls.push('auth');return true;}, isCurrentIdentity:()=>true,
    read:async()=>{calls.push('read');return [{productFamily:'dvnt_membership' as const,planKey:'dvnt_vip' as const,status:'active' as const,rail:null,source:'complimentary' as const,currentPeriodEnd:null}];},
  });
  const snapshot = entitlementReadSnapshot(records,'ready');
  const summary = lynkCreateSummary({...snapshot,isLoading:false,isError:false});
  assert.deepEqual(calls,['auth','read']); assert.equal(summary.title,'VIP · Lynk included');
});
test('failed session verification never caches an anonymous empty plan as free', async () => {
  let reads=0;
  await assert.rejects(readAuthenticatedEntitlements({ensureAuthenticated:async()=>false,isCurrentIdentity:()=>true,read:async()=>{reads++;return [];}}), /session/);
  assert.equal(reads,0);
});
test('logout or account switch during either await discards the result', async () => {
  for (const during of ['auth','read']) {
    let current=true; let reads=0;
    await assert.rejects(readAuthenticatedEntitlements({
      ensureAuthenticated:async()=>{if(during==='auth')current=false;return true;},
      isCurrentIdentity:()=>current,
      read:async()=>{reads++;current=false;return ['private'];},
    }));
    assert.equal(reads,during==='auth'?0:1);
  }
});
