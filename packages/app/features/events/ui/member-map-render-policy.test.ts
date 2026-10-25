import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleMapMembers, mapMemberInitials, mapMemberProfilePath, mapAvatarUrl } from './member-map-render-policy.ts';
const now = Date.parse('2026-10-24T12:00:00Z');
const member = {id:'fixture',username:'night owl',displayName:'Night Owl',avatarUrl:null,latitude:40.7,longitude:-74,expiresAt:'2026-10-24T12:01:00Z'};
test('only current finite coordinates appear; expiry is immediate at boundary',()=>{
  assert.equal(visibleMapMembers([member],now).length,1);
  assert.deepEqual(visibleMapMembers([member],Date.parse(member.expiresAt)),[]);
  for(const bad of [{latitude:91},{longitude:Infinity},{expiresAt:'bad'},{username:''}]) assert.deepEqual(visibleMapMembers([{...member,...bad}],now),[]);
});
test('initials survive missing photo and display name',()=>{
  assert.equal(mapMemberInitials(member),'NO');
  assert.equal(mapMemberInitials({...member,displayName:''}),'NO');
});
test('profile navigation escapes untrusted username',()=>{
  assert.equal(mapMemberProfilePath('a/b?x'),'/profile/a%2Fb%3Fx');
  assert.equal(mapMemberProfilePath('night owl',true),'/(protected)/profile/night%20owl');
});
test('avatar URLs accept only HTTPS media',()=>{
  assert.equal(mapAvatarUrl('https://cdn.example.test/avatar.png'),'https://cdn.example.test/avatar.png');
  for(const src of ['javascript:alert(1)','data:image/png;base64,abc','http://cdn.example.test/a',null,'bad']) assert.equal(mapAvatarUrl(src),null);
});
