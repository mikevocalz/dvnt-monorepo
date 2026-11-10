import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shared = fs.readFileSync(new URL('../api/users.ts',import.meta.url),'utf8');
const legacy = fs.readFileSync(new URL('../../../../apps/mobile/lib/api/users.ts',import.meta.url),'utf8');
test('shared relationship lookup propagates unavailable rather than false; anonymous headers skip lookup',async()=>{
 const source=shared.slice(shared.indexOf('async function getFollowRelationship('),shared.indexOf('type BetterAuthUserRow'));
 const js=source.replace('viewerId: number | null, targetId: number','viewerId, targetId');
 let calls=0;
 const chain:any={select(){return this;},in(){return this;},then(resolve:any){resolve({data:null,error:{message:'bridge unavailable'}});}};
 const fn=vm.runInNewContext('('+js+')',{supabase:{from(){calls++;return chain;}},DB:{follows:{table:'follows'}},resolveFollowRelationship(){throw Error('must not synthesize false');},Error});
 await assert.rejects(fn(1,2),{name:'FollowRelationshipUnavailable'});
 assert.deepEqual(JSON.parse(JSON.stringify(await fn(null,2))),{isFollowing:false,followsYou:false});
 assert.equal(calls,1);
});
test('shared/legacy profile catches propagate relationship unknown and legacy checks every follow result',()=>{
 for(const source of [shared,legacy]){
  const catches=[...source.matchAll(/catch \(error\) \{([\s\S]*?)\n    \}/g)];
  assert.ok(catches.length);
  for(const match of catches.slice(0,3)) assert.match(match[1],/FollowRelationshipUnavailable.*throw error/);
 }
 assert.equal((legacy.match(/data: followData, error: followError/g)||[]).length,3);
 assert.equal((legacy.match(/if \(followError\) throw Object.assign/g)||[]).length,3);
});
test('Activity marker errors propagate in shared and legacy instead of yielding false or empty Activity',()=>{
 for(const path of ['../../api/notifications.ts','../../../../apps/mobile/lib/api/notifications.ts']){
  const source=fs.readFileSync(new URL(path==='../../api/notifications.ts'?'../api/notifications.ts':path,import.meta.url),'utf8');
  assert.match(source,/if \(followError\) throw followError/);
  assert.match(source,/getNotifications error:", error\);[\s\S]{0,220}throw error;/);
 }
});
