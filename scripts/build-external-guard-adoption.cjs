#!/usr/bin/env node
// Offline compiler. Never accepts a database URL or calls a provider.
const fs=require('node:fs');const path=require('node:path');const {buildAdoption,root}=require('./external-guard-adoption-lib.cjs');
(async()=>{
 const guard=path.join(root,'scripts/fixtures/external-guard-adoption/standalone.sql');
 const contract=JSON.parse(fs.readFileSync(path.join(root,'scripts/fixtures/external-guard-adoption/contract.json'),'utf8'));
 const output=path.join(root,contract.adoption_migration);
 if(fs.readFileSync(guard,'utf8')!==fs.readFileSync(path.join(root,contract.guard_migration),'utf8'))throw Error('Pinned guard differs from prerequisite migration');
 const sql=await buildAdoption(fs.readFileSync(guard,'utf8'));
 if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8')!==sql)throw Error('Adoption artifact stale');console.log('Adoption artifact matches exact pinned guard and runtime.');}
 else {fs.writeFileSync(output,sql);console.log('Wrote future adoption DRAFT; no database contacted.');}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
