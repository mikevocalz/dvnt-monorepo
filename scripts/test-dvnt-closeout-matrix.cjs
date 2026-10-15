const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Baseline is the 2026-10-14 DVNT completion review. A future status update
// must provide actual evidence, not alter these counts to make CI green.
const completed = 'P01 P02 P03 P07 P08 P09 P11 P12 E01 E02 E03 E04 E05 E06 E08 E09 T02 T04 T06 T08 S02 S04 S11 R02 R03 R04'.split(' ');
const replaced = 'A04 T05 R07'.split(' ');
const groups = {
  trust: 'A01 A02 A03 A05 A06',
  proximity: 'P04 P05 S09',
  media: 'P06 P10 S05 S10',
  privateEvents: 'E07 E10 T10 S01 S03 S12',
  delivery: 'T01 T03 T07 T09 R01 R05 R06 W01',
  lynkAtomic: 'S08',
  roomControls: 'S06',
  tipping: 'S07',
  editorial: 'C01 C02 C03 C04',
  creatorDecisions: 'D01 D02 D03',
};
const everyUnresolved = Object.values(groups).flatMap(ids => ids.split(' '));

test('all 65 original IDs have exactly one disposition and no duplicate owner',()=>{
  const all=[...completed,...replaced,...everyUnresolved];
  assert.equal(completed.length,26);
  assert.equal(replaced.length,3);
  assert.equal(everyUnresolved.length,36);
  assert.equal(all.length,65);
  assert.equal(new Set(all).size,65);
  for(const id of all) assert.match(id,/^[A-Z][0-9]{2}$/);
});

test('workstream source maps each unresolved requirement without marking it done',()=>{
  const doc=readFileSync(resolve(__dirname,'../docs/release/dvnt-65-closeout-2026-10-15.md'),'utf8');
  for(const [group,ids] of Object.entries(groups)){
    for(const id of ids.split(' ')){
      assert.ok(doc.includes(id),`Missing ${group} requirement ${id}`);
    }
  }
  assert.match(doc,/Draft PRs may contain test scaffolding/);
  assert.match(doc,/No merge to|prohibited merging|explicitly prohibited merging/);
});

test('guest-checkout superseded requirements stay superseded',()=>{
  assert.deepEqual(replaced,['A04','T05','R07']);
  assert.equal(groups.trust.includes('A04'),false);
  assert.equal(groups.delivery.includes('T05'),false);
});
