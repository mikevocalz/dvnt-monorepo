#!/usr/bin/env node
// Evidence gate: unit tests and web compilation cannot stand in for physical
// devices. Schema-only CI validates the matrix; acceptance requires a real
// reviewer-provided JSON file and fails for missing/failed/skipped cases.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const cases=[
  'P06-ios-small-story-video',
  'P06-android-large-event-video',
  'P06-web-post-video-10pct-stall',
  'P06-ios-permission-denied-retry',
  'P10-ios-story-profile-link',
  'P10-android-story-profile-link',
  'P10-web-story-profile-link',
  'S05-ios-web-cross-device-host-mute',
  'S05-android-web-cross-device-host-mute',
  'S10-ios-capture-foreground',
  'S10-android-capture-flag-secure',
  'S10-web-screenshot-warning-limit'
];
const schemaOnly=process.argv.includes('--schema-only');
const file=process.argv.find(x=>x.endsWith('.json'))||
  'docs/release/dvnt-media-device-acceptance.example.json';
const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(evidence.schemaVersion,1,'Evidence schema version');
const byId=new Map();
for(const item of evidence.results||[]){
  assert.ok(typeof item.id==='string'&&!byId.has(item.id),'Missing/duplicate result ID');
  byId.set(item.id,item);
}
for(const id of cases){
  const item=byId.get(id);
  assert.ok(item,`Missing required case ${id}`);
  assert.ok(['pending','pass','fail','blocked'].includes(item.status),`Bad status for ${id}`);
  if(schemaOnly) continue;
  assert.equal(item.status,'pass',`${id} not passed on real device`);
  for(const key of ['device','osVersion','buildSha','evidenceUrl','testedAt','tester']){
    assert.ok(typeof item[key]==='string' && item[key].trim(),`${id} needs ${key}`);
  }
  assert.ok(Date.parse(item.testedAt)>0,`Invalid test timestamp: ${id}`);
  assert.match(item.evidenceUrl,/^https:\/\//,`Evidence link must be HTTPS: ${id}`);
}
console.log(schemaOnly
  ? `DVNT media/device acceptance schema valid: ${cases.length} required cases. NO live tests claimed.`
  : `DVNT real-device acceptance complete: ${cases.length} independent passes.`);
