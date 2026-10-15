#!/usr/bin/env node
const fs=require("node:fs"),assert=require("node:assert/strict");
const required=[
  "stripe-testmode-guest-checkout-ticket-qr-refund",
  "guest-checkout-event-preserved",
  "ticket-embed-responsive-web-mobile",
  "payout-setup-reminder",
  "seller-1-stripe-kyc-complete",
  "seller-2-stripe-kyc-complete",
  "vip-grants-and-badges",
  "profile-photo-first-post-blocking",
  "profile-popup-persistence",
  "hashtags-and-broadcast-event-link",
  "web-comment-delete-confirm-cancel-retry",
  "sentry-DVNT-WEB-1X-viewport-transition",
  "edge-alerts-516-517-root-cause",
  "native-build-and-ota-device",
  "production-rollback-and-no-main-merge"
];
const schemaOnly=process.argv.includes("--schema-only");
const file=process.argv.find(p=>p.endsWith(".json"))||
 "docs/release/dvnt-prod-release-gate.example.json";
const results=JSON.parse(fs.readFileSync(file,"utf8"));
assert.equal(results.schemaVersion,1);
const keys=new Set();
for(const row of results.checks||[]){
  assert.ok(!keys.has(row.id),"duplicate release ID "+row.id);
  keys.add(row.id);
}
for(const id of required){
  const row=(results.checks||[]).find(x=>x.id===id);
  assert.ok(row,"missing release gate "+id);
  assert.ok(["pending","blocked","pass","fail"].includes(row.status));
  if(schemaOnly) continue;
  assert.equal(row.status,"pass",id+" not independently verified");
  for(const key of ["buildSha","environment","evidenceUrl","verifiedAt","reviewer"]){
    assert.ok(String(row[key]||"").trim(),id+" requires "+key);
  }
  assert.match(row.evidenceUrl,/^https:\/\//);
  assert.ok(Date.parse(row.verifiedAt)>0);
}
console.log(schemaOnly
 ? required.length+" production-release checks declared. NO production success claimed."
 : required.length+" release checks independently passed.");
