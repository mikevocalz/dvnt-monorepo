const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isConfiguredPlatformOwner, applyEventDisputeHold } = require('./owner-dispute-policy.ts');
function db(host, readError = null, writeError = null) {
 const writes=[];
 return {writes, from:()=> {let writing=false; const q={
  select:()=>q,eq:()=>q,single:()=>q,
  update:(value)=>{writing=true;writes.push(value);return q;},
  then:(resolve,reject)=>Promise.resolve(writing ? {data:[{id:1}],error:writeError} : {data:host ? {host_id:host}:null,error:readError}).then(resolve,reject)
 };return q;}};
}
test('empty, malformed, client objects and forged owner names never bypass policy',()=>{
 for (const config of [undefined,null,'',' ', ' owner-auth ',{},['owner-auth']]) assert.equal(isConfiguredPlatformOwner('owner-auth',config),false);
 for(const host of ['deviantevents','Super-Admin',{auth_id:'owner-auth'},null,'other-auth']) assert.equal(isConfiguredPlatformOwner(host,'owner-auth'),false);
 assert.equal(isConfiguredPlatformOwner('owner-auth','owner-auth'),true);
});
test('ordinary event still receives whole-event dispute hold',async()=>{
 const d=db('other-auth');assert.equal(await applyEventDisputeHold(d,1,'owner-auth'),true);assert.deepEqual(d.writes,[{payout_status:'on_hold'}]);
});
test('configured owner event receives no blanket hold or release write',async()=>{
 const d=db('owner-auth'); assert.equal(await applyEventDisputeHold(d,1,'owner-auth'),false);assert.deepEqual(d.writes,[]);
});
test('unknown host, missing config and identity read errors fail closed',async()=>{
 for(const [host,config,error] of [[null,'owner-auth',null],['owner-auth','',null],['owner-auth','owner-auth',new Error('read')]]){
  const d=db(host,error);assert.equal(await applyEventDisputeHold(d,1,config),true);assert.equal(d.writes.length,1);
 }
});
test('failed normal hold write is not acknowledged',async()=>{
 await assert.rejects(applyEventDisputeHold(db('other-auth',null,new Error('write failed')),1,'owner-auth'),/write failed/);
});
test('webhook persists order dispute before exemption and does not suppress risk timeline',()=>{
 const source=fs.readFileSync(__dirname+'/../stripe-webhook/index.ts','utf8');
 const handler=source.slice(source.indexOf('case "charge.dispute.created"'),source.indexOf('case "account.updated"'));
 assert.ok(handler.indexOf('status: "disputed"') < handler.indexOf('await applyEventDisputeHold'));
 assert.match(handler,/if \(disputeWriteError\) throw disputeWriteError/);
 assert.match(handler,/type: "dispute_opened"/);
 assert.match(handler,/Deno.env.get\("DVNT_PLATFORM_OWNER_AUTH_ID"\)/);
 assert.doesNotMatch(handler,/payout_status: "pending"|username|user_type|Super-Admin/);
});
