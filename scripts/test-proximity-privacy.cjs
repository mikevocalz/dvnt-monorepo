const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const read=p=>readFileSync(resolve(__dirname,'..',p),'utf8');
const sql=read('apps/mobile/supabase/migrations/20261002165000_member_proximity_presence.sql');
const api=read('packages/app/lib/api/member-proximity.ts');
const edge=read('apps/mobile/supabase/functions/member-proximity/index.ts');
test('raw coordinates are service-only and the presence share expires',()=>{
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql,/REVOKE ALL.*anon, authenticated/i);
  assert.match(sql,/share_until timestamptz NOT NULL/);
  assert.ok(!/GRANT SELECT[^;]+TO authenticated/i.test(sql));
});
test('distance lookup requires target username, not caller spoofed location',()=>{
  const m=api.match(/distance\(input:[\s\S]*?\n  \},/);
  assert.ok(m,'distance call missing');
  assert.doesNotMatch(m[0],/latitude|longitude/);
  assert.match(edge,/resolveVerifiedAdmission/);
  assert.match(edge,/checkRateLimit/);
});
test('distance response stays coarse and never returns member GPS coordinates',()=>{
  assert.match(api,/MemberProximityBand/);
  assert.match(api,/\"under_1\"/);
  assert.ok(!/kind: \"distance\";\s*latitude/.test(api));
});

test('restricted users retain the ability to withdraw previously shared GPS',()=>{
  const revoke=edge.indexOf('if (action === "revoke")');
  const admission=edge.indexOf('const admission = await resolveVerifiedAdmission');
  assert.ok(revoke>0 && admission>revoke, 'revoke must precede access enforcement');
  assert.match(edge,/Could not stop proximity sharing/);
});
test('unreadable block relationships fail closed',()=>{
  assert.match(edge,/blockedForward\.error \|\| blockedReverse\.error/);
});
test('the profile never fabricates mileage from city or device centroids',()=>{
  const profile=read('packages/app/features/profile/user-profile.web.tsx');
  assert.doesNotMatch(profile,/resolveViewerPosition|proximityLabel|matchCity/);
  assert.match(profile,/useMemberProximity/);
});
test('native and web controls require distinct consent and expire with city sharing',()=>{
  const store=read('packages/app/lib/stores/events-location-store.ts');
  const web=read('packages/app/features/settings/privacy.web.tsx');
  const native=read('packages/app/features/settings/ui/CityVisibilityCard.tsx');
  assert.match(store,/setPreciseProximityGrant/);
  assert.match(store,/readCityVisibility\(state\.cityVisibility, Date\.now\(\)\)/);
  assert.match(store,/preciseProximityGrant: false/);
  assert.match(web,/PROXIMITY_COPY\.toggleLabel/);
  assert.match(native,/PROXIMITY_COPY\.toggleLabel/);
});

test('proximity consent is tied to an account and cannot leak to a different login',()=>{
  const store=read('packages/app/lib/stores/events-location-store.ts');
  const hook=read('packages/app/lib/hooks/use-member-proximity.ts');
  assert.match(store,/preciseProximityOwnerAuthId/);
  assert.match(store,/setPreciseProximityGrant: \(enabled, ownerAuthId\)/);
  assert.match(hook,/location\.preciseProximityOwnerAuthId === authId/);
  assert.match(hook,/useAuthStore\.getState\(\)\.user\?\.authId !== authId/);
});
test('withdrawal waits behind an unfinished publish and reads current preference',()=>{
  const hook=read('packages/app/lib/hooks/use-member-proximity.ts');
  assert.match(hook,/queue\.current = queue\.current\.catch/);
  assert.match(hook,/useEventsLocationStore\.getState\(\)/);
  assert.match(hook,/await memberProximityApi\.revoke\(\)/);
});
