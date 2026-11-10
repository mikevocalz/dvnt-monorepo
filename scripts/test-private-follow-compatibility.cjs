const test=require('node:test'),assert=require('node:assert/strict');
const {validate,CASES}=require('./check-private-follow-compatibility.cjs');
const example=require('../docs/release/private-follow-compatibility.example.json');
function fixture(){
 const source='a'.repeat(40),url='https://evidence.invalid/synthetic-test-only';
 return {schemaVersion:1,scope:'recorded-devices-only',activationPerformed:false,status:'ready-for-review',candidateSourceCommit:source,
 supportedCohorts:[{id:'ios-fixture',platform:'ios',build:'123',runtimeVersion:'runtime-fixture'}],
 devices:[{id:'fixture-not-real-evidence',cohortId:'ios-fixture',platform:'ios',build:'123',runtimeVersion:'runtime-fixture',osVersion:'18',appVersion:'1',tester:'test fixture',testedAt:'2026-01-01T00:00:00Z',environment:'production-synthetic-accounts',realDevice:true,launch:'embedded',embedded:true,updateId:null,sourceCommit:source,sourceMappingEvidenceUrl:url,evidenceUrl:url,checks:CASES.map(id=>({id,status:'pass',evidenceUrl:url}))}],
 fleetReview:{status:'reviewed',anonymousLegacyClientsRemaining:false,inventoryEvidenceUrl:url,unsupportedClientDispositionEvidenceUrl:url,reviewer:'fixture',reviewedAt:'2026-01-01T00:00:00Z'}};
}
test('default example is held and declaration cannot claim readiness',()=>{
 assert.match(validate(example,{declarationOnly:true}),/HELD/);assert.throws(()=>validate(example));
 assert.throws(()=>validate(fixture(),{declarationOnly:true}));
});
test('complete synthetic embedded and OTA fixtures only yield manual review',()=>{
 const m=fixture();assert.match(validate(m),/Manual release review/);
 Object.assign(m.devices[0],{launch:'ota',embedded:false,updateId:'fixture-update'});assert.match(validate(m),/No activation/);
});
const mutations={
 missingRuntime:m=>delete m.devices[0].runtimeVersion,
 missingBuild:m=>delete m.devices[0].build,
 unmappedSource:m=>m.devices[0].sourceCommit='b'.repeat(40),
 missingMapping:m=>m.devices[0].sourceMappingEvidenceUrl='',
 missingOtaId:m=>Object.assign(m.devices[0],{launch:'ota',embedded:false,updateId:null}),
 ambiguousEmbedded:m=>m.devices[0].updateId='some-update',
 simulator:m=>m.devices[0].realDevice=false,
 staging:m=>m.devices[0].environment='staging',
 noFleetReview:m=>m.fleetReview.status='pending',
 remainingLegacy:m=>m.fleetReview.anonymousLegacyClientsRemaining=true,
 noInventory:m=>m.fleetReview.inventoryEvidenceUrl='',
 noRetirement:m=>m.fleetReview.unsupportedClientDispositionEvidenceUrl='',
 allInstallationsClaim:m=>m.scope='all-installations',
 activation:m=>m.activationPerformed=true,
 untestedCohort:m=>m.supportedCohorts.push({id:'android',platform:'android',build:'2',runtimeVersion:'two'}),
 duplicateDevice:m=>m.devices.push(m.devices[0]),
 duplicateCase:m=>m.devices[0].checks.push(m.devices[0].checks[0]),
 futureEvidence:m=>m.devices[0].testedAt='2099-01-01',
};
for(const [name,mutate] of Object.entries(mutations))test('reject '+name,()=>{const m=fixture();mutate(m);assert.throws(()=>validate(m));});
for(const id of CASES)test('requires passing real-device case '+id,()=>{
 const m=fixture();m.devices[0].checks.find(c=>c.id===id).status='pending';assert.throws(()=>validate(m));
});
