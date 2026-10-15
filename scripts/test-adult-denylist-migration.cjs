#!/usr/bin/env node
// Static checks on 20261015121000_denylist_outranks_verified_adult.sql.
// node scripts/test-adult-denylist-migration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const migrations = path.join(path.resolve(__dirname, '..'), 'apps/mobile/supabase/migrations');
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8');
const fresh = read('20261015121000_denylist_outranks_verified_adult.sql');
function definition(sql, name) {
  const found = sql.match(new RegExp('^CREATE OR REPLACE FUNCTION public\\.' + name + '\\(\\)[\\s\\S]*?^\\$\\$;', 'm'));
  assert.ok(found, `missing function ${name}`);
  return found[0];
}
const grants = (sql, name) => sql.split('\n')
  .filter(line => /^(REVOKE|GRANT) /.test(line) && line.includes(`public.${name}()`));

// verified_participation_allowed: the previous body plus one branch, nothing else.
const DENY = "          -- An operator-denied account stays closed whatever the rollout\n" +
  "          -- switch, the allowlist or a passed ID says.\n" +
  "          WHEN sub.id IS NOT NULL AND sub.id = ANY (p.denylist) THEN false\n";
const RESTRICTED = "          -- A checkout-created profile is locked until it passes adult\n";
const previous = read('20261003180000_checkout_restricted_profiles.sql');
const oldVpa = definition(previous, 'verified_participation_allowed');
const newVpa = definition(fresh, 'verified_participation_allowed');
assert.equal(oldVpa.split(RESTRICTED).length, 2, 'baseline anchor must be unique');
assert.equal(newVpa, oldVpa.replace(RESTRICTED, () => DENY + RESTRICTED),
  'verified_participation_allowed must be the 20261003180000 body plus only the denylist branch');
const at = s => { const i = newVpa.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i; };
assert.ok(at("v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')") < at('sub.id = ANY (p.denylist) THEN false'),
  'under-18 branch stays first');
assert.ok(at('sub.id = ANY (p.denylist) THEN false') < at('public.is_checkout_restricted(sub.id) THEN false'),
  'denylist precedes checkout-restricted');
assert.ok(at('sub.id = ANY (p.denylist) THEN false') < at('WHEN NOT p.enforce THEN true'),
  'denylist precedes NOT p.enforce');
assert.ok(at('sub.id = ANY (p.denylist) THEN false') < at('public.is_verified_self()'),
  'denylist precedes the passed-ID branch');
assert.deepEqual(grants(fresh, 'verified_participation_allowed'), grants(previous, 'verified_participation_allowed'));

// viewer_is_verified_adult: service role first, denylist gates both adult branches.
const legacy = read('20261011203000_legacy_adult_access.sql');
const oldViva = definition(legacy, 'viewer_is_verified_adult');
const newViva = definition(fresh, 'viewer_is_verified_adult');
const header = s => s.split(' SELECT ')[0];
assert.equal(header(newViva), header(oldViva), 'SECURITY DEFINER and search_path unchanged');
const vi = s => { const i = newViva.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i; };
assert.ok(vi("= 'service_role'") < vi('ANY (p.denylist)'), 'service role short-circuits before the denylist');
assert.ok(vi('NOT EXISTS (SELECT 1 FROM public.verified_admission_policy p') < vi('FROM public.identity_verifications v'),
  'denylist gates the passed-ID branch');
assert.ok(vi('ANY (p.denylist))\n   AND (') > 0, 'denylist is ANDed with the adult branches');
assert.ok(vi('ANY (p.denylist)') < vi('public.legacy_adult_content_access('), 'denylist gates the legacy branch');
assert.deepEqual(grants(fresh, 'viewer_is_verified_adult'), grants(legacy, 'viewer_is_verified_adult'));

// No later migration may redefine either function without this branch.
for (const file of fs.readdirSync(migrations).filter(f => /^\d{14}_.*\.sql$/.test(f) && f > '20261015121000')) {
  const sql = read(file);
  for (const name of ['verified_participation_allowed', 'viewer_is_verified_adult']) {
    if (sql.includes(`FUNCTION public.${name}()`) && /CREATE (OR REPLACE )?FUNCTION/.test(sql)) {
      assert.match(definition(sql, name), /ANY \(p\.denylist\)/, `${file} redefines ${name} without the denylist`);
    }
  }
}
console.log('adult denylist migration: ok');
