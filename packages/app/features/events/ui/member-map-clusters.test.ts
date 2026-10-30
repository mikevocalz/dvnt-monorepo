import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterMapMembers } from './member-map-clusters.ts';
const member = { id:'a', username:'a', displayName:'A', avatarUrl:null, latitude:40.7, longitude:-74, expiresAt:'2099-01-01T00:00:00Z' };
test('exact coarse cells cluster at every zoom without changing coordinates', () => {
 const members = [member, {...member,id:'self'}];
 for (const zoom of [0,3,12,18,22]) {
  const groups = clusterMapMembers(members,zoom);
  assert.equal(groups.length,1); assert.equal(groups[0].members.length,2);
  assert.equal(groups[0].latitude,member.latitude); assert.equal(groups[0].longitude,member.longitude);
 }
 assert.deepEqual(members[0],member);
});
test('nearby groups split with zoom, preserve everyone, stable for reordered updates', () => {
 const members = [member,{...member,id:'b',longitude:-73.999},{...member,id:'c',latitude:41}];
 assert.deepEqual(clusterMapMembers(members,12).map(g=>g.members.length),[2,1]);
 assert.equal(clusterMapMembers(members,19).length,3);
 assert.deepEqual(clusterMapMembers(members,12),clusterMapMembers([...members].reverse(),12));
 assert.deepEqual(clusterMapMembers([],12),[]);
 assert.equal(clusterMapMembers(members.slice(0,1),12)[0].id,'member:a');
});
test('wrapped longitude proximity works at date line and poles stay finite', () => {
 const groups = clusterMapMembers([{...member,longitude:179.999},{...member,id:'b',longitude:-179.999}],12);
 assert.equal(groups.length,1);
 assert.ok(Number.isFinite(clusterMapMembers([{...member,latitude:90}],12)[0].latitude));
});

test('adjacent multi-avatar groups cannot overlap the 108px cluster previews', () => {
 const delta = 80 / (256 * 2 ** 12) * 360;
 const members = [member,{...member,id:'b'},{...member,id:'c',longitude:member.longitude+delta},{...member,id:'d',longitude:member.longitude+delta}];
 assert.equal(clusterMapMembers(members,12).length,1);
});
