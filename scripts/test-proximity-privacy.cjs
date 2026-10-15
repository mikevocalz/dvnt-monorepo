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
