import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareComplimentaryVipSql } from './prepare-complimentary-vip-grants.mjs';
const manifest=()=>({
  actor:{id:1,username:'operator',authId:'actor-auth'},expiresAt:null,reason:"Owner's explicit approval",
  recipients:[{id:2,username:"member'quoted",authId:'member-auth',eligibility:{kind:'named_recipient'},requestId:'00000000-0000-4000-8000-000000000001'}],
});
test('preparation requires exact identities, no expiry, and stable deduplication keys',()=>{
  const sql=prepareComplimentaryVipSql(manifest());
  assert.match(sql,/BEGIN ISOLATION LEVEL SERIALIZABLE;/);assert.match(sql,/COMMIT;/);
  assert.match(sql,/username='member''quoted'/);assert.match(sql,/Owner''s explicit approval/);
  assert.match(sql,/grant_complimentary_vip\(2,1,.*NULL,/);
  assert.ok(!sql.includes('membership_subscriptions'));
  assert.throws(()=>prepareComplimentaryVipSql({...manifest(),expiresAt:'2099-01-01'}),/no expiry/);
  assert.throws(()=>prepareComplimentaryVipSql({...manifest(),recipients:[...manifest().recipients,...manifest().recipients]}),/Unique/);
  assert.throws(()=>prepareComplimentaryVipSql({...manifest(),actor:{id:1,username:'unknown'}}),/snapshot/);
});

test('SQL dollar delimiters cannot be escaped by identity input',()=>{
  const input=manifest();input.recipients[0].username="$snapshot$'; DO $evil$ BEGIN RAISE EXCEPTION 'bad'; END $evil$; --";
  const sql=prepareComplimentaryVipSql(input);
  assert.match(sql,/DO \$_snapshot\$ BEGIN/);
  assert.match(sql,/FOR SHARE/);assert.match(sql,/Grant readback failed/);
});
