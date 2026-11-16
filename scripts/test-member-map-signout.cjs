const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const path=require('node:path');
const {buildSync}=require('esbuild');
test('sign-out detaches session but never re-enables writers or requests global revoke',async()=>{
 const fixture={owner:'viewer',blocked:false,calls:[],pendingWithdrawal:false};
 const context={fixture,setTimeout,clearTimeout,Promise,exports:{}};
 context.require=id=>{
  if(id.endsWith('auth-store'))return {useAuthStore:{getState:()=>({user:{authId:fixture.owner}})}};
  if(id.endsWith('location-access-store'))return {useLocationAccessStore:{getState:()=>({selectOwner(){},stop(){fixture.blocked=true},accept(){throw Error('Must not restore consent during signout')}})}};
  if(id.endsWith('events-location-store'))return {useEventsLocationStore:{setState:x=>fixture.location=x}};
  if(id.endsWith('exact-distance-store'))return {useExactDistanceStore:{getState:()=>({beginWithdrawal(){},confirmWithdrawal(){fixture.exactConfirmed=true}})}};
  if(id.endsWith('api/member-map'))return {memberMapApi:{detachSession:async()=>{fixture.calls.push('detach');return {locationEnabled:true,eventsMapEnabled:true,consentVersion:'events-map-account-v3',shareUntil:null}},revoke:()=>{throw Error('Global revoke forbidden')}}};
  if(id.endsWith('api/member-proximity'))return {memberProximityApi:{revokeExact:async()=>{fixture.calls.push('exact')}}};
  throw Error(id);
 };
 const output=buildSync({entryPoints:[path.join(__dirname,'../packages/app/lib/location/revoke-location-on-signout.ts')],bundle:false,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
 context.module={exports:context.exports};vm.runInNewContext(output,context);
 await context.module.exports.revokeLocationOnSignOut();
 assert.deepEqual(fixture.calls,['detach','exact']);assert.equal(fixture.blocked,true);assert.equal(fixture.location.deviceLat,null);assert.equal(fixture.exactConfirmed,true);
});
