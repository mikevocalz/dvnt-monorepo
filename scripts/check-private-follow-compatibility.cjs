#!/usr/bin/env node
// Read-only evidence validation. This script cannot deploy or activate a gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const CASES = ['own-relationships', 'private-outsider-denied', 'preserved-followers',
  'request-approve', 'request-decline', 'request-cancel', 'activity-request-and-approval',
  'bridge-failure-unknown-not-false', 'bridge-recovery', 'inbox-spam-classification',
  'account-switch-isolation'];
const text = (v, label) => assert.ok(typeof v === 'string' && v.trim(), label);
const url = (v, label) => { text(v,label); const u=new URL(v); assert.equal(u.protocol,'https:',label); assert.ok(!u.username&&!u.password,label); };
const sha = (v) => assert.match(v,/^[a-f0-9]{40}$/,'full source commit required');
const date = (v) => { text(v,'timestamp required'); assert.ok(Number.isFinite(Date.parse(v)) && Date.parse(v)<=Date.now(),'valid nonfuture timestamp required'); };
function validate(m,{declarationOnly=false}={}) {
 assert.equal(m.schemaVersion,1);
 assert.equal(m.scope,'recorded-devices-only','device evidence is not fleet coverage');
 assert.equal(m.activationPerformed,false,'validator never activates');
 assert.ok(['held','ready-for-review'].includes(m.status));
 assert.ok(Array.isArray(m.supportedCohorts)&&m.supportedCohorts.length>0,'declare supported runtime/build cohorts');
 assert.ok(Array.isArray(m.devices));
 const cohorts=new Set();
 for(const c of m.supportedCohorts){
  text(c.id,'cohort ID'); assert.ok(!cohorts.has(c.id),'duplicate cohort'); cohorts.add(c.id);
  assert.ok(['ios','android'].includes(c.platform)); text(c.build,'build');text(c.runtimeVersion,'runtime');
 }
 if(declarationOnly) {
  assert.equal(m.status,'held','declaration must remain held');
  return 'Declaration only: HELD. No installed-client compatibility or activation claimed.';
 }
 assert.equal(m.status,'ready-for-review','compatibility remains held');
 sha(m.candidateSourceCommit);
 const seen=new Set(),covered=new Set();
 for(const d of m.devices){
  text(d.id,'device evidence ID');assert.ok(!seen.has(d.id),'duplicate device');seen.add(d.id);
  const c=m.supportedCohorts.find(x=>x.id===d.cohortId);assert.ok(c,'unknown cohort');
  for(const k of ['platform','build','runtimeVersion']) assert.equal(d[k],c[k],'cohort '+k+' mismatch');
  text(d.osVersion,'OS');text(d.appVersion,'app version');text(d.tester,'tester');date(d.testedAt);
  assert.equal(d.environment,'production-synthetic-accounts','real signed-in production acceptance required');
  assert.equal(d.realDevice,true,'real device required');
  assert.ok(['embedded','ota'].includes(d.launch));
  if(d.launch==='ota') {text(d.updateId,'OTA update ID');assert.equal(d.embedded,false);}
  else {assert.equal(d.updateId,null);assert.equal(d.embedded,true);}
  sha(d.sourceCommit);assert.equal(d.sourceCommit,m.candidateSourceCommit,'device source differs');
  url(d.sourceMappingEvidenceUrl,'build/update source mapping evidence');url(d.evidenceUrl,'device evidence');
  const checks=new Map();
  for(const row of d.checks||[]){assert.ok(CASES.includes(row.id),'unknown case');assert.ok(!checks.has(row.id),'duplicate case');checks.set(row.id,row);}
  for(const id of CASES){const row=checks.get(id);assert.ok(row,'missing '+id);assert.equal(row.status,'pass',id+' incomplete');url(row.evidenceUrl,id+' evidence');}
  covered.add(d.cohortId);
 }
 for(const id of cohorts)assert.ok(covered.has(id),'untested declared cohort '+id);
 // A device sample cannot prove all old installations were updated or retired.
 assert.equal(m.fleetReview.status,'reviewed','separate installed-fleet review required');
 assert.equal(m.fleetReview.anonymousLegacyClientsRemaining,false,'anonymous legacy clients unresolved');
 url(m.fleetReview.inventoryEvidenceUrl,'fleet inventory evidence');
 url(m.fleetReview.unsupportedClientDispositionEvidenceUrl,'unsupported clients retirement/upgrade evidence');
 text(m.fleetReview.reviewer,'fleet reviewer');date(m.fleetReview.reviewedAt);
 return 'Recorded device evidence complete for declared cohorts; fleet review supplied. Manual release review still required. No activation performed; evidence truth or all installations cannot be proven by this validator.';
}
module.exports={validate,CASES};
if(require.main===module){
 try{
  const file=process.argv.find(v=>v.endsWith('.json'))||'docs/release/private-follow-compatibility.example.json';
  console.log(validate(JSON.parse(fs.readFileSync(file,'utf8')),{declarationOnly:process.argv.includes('--declaration-only')}));
 }catch(e){console.error('HELD: '+e.message);process.exitCode=1;}
}
