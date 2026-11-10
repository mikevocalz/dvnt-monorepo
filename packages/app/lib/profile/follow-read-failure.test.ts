import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';

const shared = fs.readFileSync(new URL('../api/users.ts',import.meta.url),'utf8');
const legacy = fs.readFileSync(new URL('../../../../apps/mobile/lib/api/users.ts',import.meta.url),'utf8');
test('shared/legacy relationship lookup uses verified viewer and propagates unknown; anonymous headers skip lookup',async()=>{
 for (const text of [shared, legacy]) {
  const source=text.slice(text.indexOf('async function getFollowRelationship('),text.indexOf('type BetterAuthUserRow'));
  const js=source.replace('viewerId: number | null, targetId: number','viewerId, targetId');
  let calls=0;
  const fn=vm.runInNewContext('('+js+')',{
   getFollowIdentity:()=>({viewerId:'1'}),
   async getOwnFollowRelationships(){calls++;throw Error('service unavailable');},Error,
  });
  await assert.rejects(fn(1,2),{name:'FollowRelationshipUnavailable'});
  await assert.rejects(fn(3,2),{name:'FollowRelationshipUnavailable'});
  assert.deepEqual(JSON.parse(JSON.stringify(await fn(null,2))),{isFollowing:false,followsYou:false});
  assert.equal(calls,1);
 }
});
test('verified pairs retain both outgoing and incoming markers',async()=>{
 const source=shared.slice(shared.indexOf('async function getFollowRelationship('),shared.indexOf('type BetterAuthUserRow'));
 const fn=vm.runInNewContext('('+source.replace('viewerId: number | null, targetId: number','viewerId, targetId')+')',{
  getFollowIdentity:()=>({viewerId:'1'}),
  async getOwnFollowRelationships(){return [{targetId:2,isFollowing:true,followsYou:true}];},Error,
 });
 assert.deepEqual(JSON.parse(JSON.stringify(await fn(1,2))),{isFollowing:true,followsYou:true});
});
test('shared/legacy profile catches propagate relationship unknown and legacy checks every follow result',()=>{
 for(const source of [shared,legacy]){
  const catches=[...source.matchAll(/catch \(error\) \{([\s\S]*?)\n    \}/g)];
  assert.ok(catches.length);
  for(const match of catches.slice(0,3)) assert.match(match[1],/FollowRelationshipUnavailable.*throw error/);
 }
 assert.equal((legacy.match(/await getFollowRelationship\(Number\(currentUserId\)/g)||[]).length,3);
 assert.doesNotMatch(shared, /from\(DB.follows.table\)/);
 assert.doesNotMatch(legacy, /from\(DB.follows.table\)/);
});
test('Activity marker errors propagate in shared and legacy instead of yielding false or empty Activity',()=>{
 for(const path of ['../../api/notifications.ts','../../../../apps/mobile/lib/api/notifications.ts']){
  const source=fs.readFileSync(new URL(path==='../../api/notifications.ts'?'../api/notifications.ts':path,import.meta.url),'utf8');
  assert.match(source,/getOwnFollowRelationships/);
  assert.match(source,/getNotifications error:", error\);[\s\S]{0,220}throw error;/);
 }
});
