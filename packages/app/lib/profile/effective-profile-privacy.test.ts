import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
import { readEffectiveProfilePrivacy, isProfilePrivacyUnavailable } from './effective-profile-privacy.ts';

for (const value of [true, false]) test(`effective privacy accepts server boolean ${value}`, async () => {
  assert.equal(await readEffectiveProfilePrivacy({ rpc: async (name, args) => {
    assert.equal(name, 'profile_is_private');
    assert.deepEqual(args, {p_user_id: 42});
    return { data: value, error: null };
  } }, 42), value);
});
test('privacy unavailable, malformed or missing never falls back to Public', async () => {
  for (const data of [null, undefined, 'false', 0, {}, []]) {
    await assert.rejects(readEffectiveProfilePrivacy({rpc: async () => ({data, error:null})}, 42), {name:'ProfilePrivacyUnavailable'});
  }
  await assert.rejects(readEffectiveProfilePrivacy({rpc: async () => ({data:false, error:{code:'unavailable'}})}, 42), {name:'ProfilePrivacyUnavailable'});
  await assert.rejects(readEffectiveProfilePrivacy({rpc: async () => {throw Error('offline');}}, 42), {name:'ProfilePrivacyUnavailable'});
  for (const id of [0,-1,NaN,1.5]) await assert.rejects(readEffectiveProfilePrivacy({rpc: async () => {throw Error('must not call');}}, id), {name:'ProfilePrivacyUnavailable'});
});
test('shared and legacy username, numeric/auth ID and auth fallback paths all read effective privacy', () => {
  for (const path of ['../api/users.ts','../../../../apps/mobile/lib/api/users.ts']) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal((source.match(/readEffectiveProfilePrivacy\(supabase,/g)||[]).length, 3);
    assert.equal((source.match(/error.name === "ProfilePrivacyUnavailable"\) throw error/g)||[]).length, 3);
    assert.doesNotMatch(source, /isPrivate: (data|profile)\[DB.users.isPrivate\]/);
    assert.doesNotMatch(source, /from\("user_settings"\)/);
  }
});

test('unavailable error overrides even a stale Public profile, not just an empty cache', () => {
  const staleProfile = {isPrivate:false};
  const error = Object.assign(new Error('offline'), {name:'ProfilePrivacyUnavailable'});
  assert.equal(isProfilePrivacyUnavailable(error),true);
  assert.equal(staleProfile.isPrivate,false);
  assert.equal(isProfilePrivacyUnavailable(null),false);
  for (const path of ['../../features/profile/user-profile.web.tsx','../../features/routes/screens/(protected)/profile/[username].tsx']) {
    const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(source,/if \(isProfilePrivacyUnavailable\((profileError|error)\)/);
    const guard=source.indexOf('if (isProfilePrivacyUnavailable(');
    assert.ok(guard<source.indexOf('<PrivateProfileNotice'));
    assert.doesNotMatch(source.slice(guard,source.indexOf('return (',guard)).split('||')[0],/!userData/);
  }
});

test('native fallback privacy failure does not block a recovered primary profile', () => {
  const source=fs.readFileSync(new URL('../../features/routes/screens/(protected)/profile/[username].tsx',import.meta.url),'utf8');
  assert.match(source,/!userData && isProfilePrivacyUnavailable\(authProfileError\)/);
  const fallbackError = Object.assign(new Error('old fallback failure'), {name:'ProfilePrivacyUnavailable'});
  const blocked = (userData: unknown, error: unknown) => isProfilePrivacyUnavailable(error) || (!userData && isProfilePrivacyUnavailable(fallbackError));
  assert.equal(blocked(undefined,null),true);
  assert.equal(blocked({isPrivate:true},null),false);
  assert.equal(blocked({isPrivate:false},fallbackError),true);
});
