#!/usr/bin/env node
const fs=require('node:fs');
const assert=require('node:assert/strict');
const required=[
  "guest-checkout-selected-event",
  "private-event-invitee-can-view",
  "private-event-forwarded-link-denied",
  "private-event-cross-account-profile",
  "paid-ticket-verified-room-admitted",
  "paid-ticket-unverified-room-denied",
  "comp-claim-admitted-once",
  "nonbuyer-and-expired-link-denied",
  "web-host-native-guest-media",
  "native-host-web-guest-media",
  "room-host-end-reconnect-denied",
  "offline-reconnect-and-background",
  "micah-dc-qr-ticket-finance-reconciliation",
  "stripe-test-purchase-issue-wallet-refund"
];
const schemaOnly=process.argv.includes('--schema-only');
const file=process.argv.find(x=>x.endsWith('.json'))||'docs/release/dvnt-private-events-acceptance.example.json';
const doc=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(doc.schemaVersion,1);
const seen=new Set();
for(const r of doc.results||[]){
  assert.ok(!seen.has(r.id),`Duplicate case ${r.id}`);
  seen.add(r.id);
}
for(const id of required){
  const e=(doc.results||[]).find(x=>x.id===id);
  assert.ok(e,`Missing acceptance case ${id}`);
  assert.ok(['pending','blocked','pass','fail'].includes(e.status),`Invalid ${id}`);
  if(!schemaOnly){
    assert.equal(e.status,'pass',`Case ${id} has no verified success`);
    for(const field of ['environment','buildSha','testId','evidenceUrl','testedAt','tester']){
      assert.ok(String(e[field]||'').trim(),`${id} requires ${field}`);
    }
    assert.match(e.evidenceUrl,/^https:\/\//);
  }
}
console.log(schemaOnly
 ? `Private events acceptance matrix structurally valid (${required.length}); NO tests claimed.`
 : `Private events accepted: ${required.length} passed with evidence.`);
