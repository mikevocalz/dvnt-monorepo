#!/usr/bin/env node
// Offline compiler. Never accepts a database URL or calls a provider.
const fs=require('node:fs');const path=require('node:path');const {buildAdoption,validateBuildContract,root}=require('./external-guard-adoption-lib.cjs');
(async()=>{
 const guard=path.join(root,'scripts/fixtures/external-guard-adoption/standalone.sql');
 const args=process.argv.slice(2);
 if(args.some(x=>x!=='--check'&&!x.startsWith('--contract=')))throw Error('Unknown compiler option');
 const bindings=args.filter(x=>x.startsWith('--contract='));if(bindings.length>1)throw Error('Only one exact build contract is allowed');
 const input=path.resolve(root,bindings[0]?.slice('--contract='.length)||'scripts/fixtures/external-guard-adoption/contract.json');
 if(!input.startsWith(root+path.sep)||path.extname(input)!=='.json')throw Error('Build contract must be a repository JSON file');
 const contract=JSON.parse(fs.readFileSync(input,'utf8'));
 validateBuildContract(contract,fs.readFileSync(guard,'utf8'));
 const output=path.join(root,contract.adoption_migration);
 if(fs.readFileSync(guard,'utf8')!==fs.readFileSync(path.join(root,contract.guard_migration),'utf8'))throw Error('Pinned guard differs from prerequisite migration');
 const sql=await buildAdoption(fs.readFileSync(guard,'utf8'),contract);
 if(process.argv.includes('--check')){if(fs.readFileSync(output,'utf8')!==sql)throw Error('Adoption artifact stale');console.log('Adoption artifact matches exact pinned guard and runtime.');}
 else {fs.writeFileSync(output,sql);console.log('Wrote future adoption DRAFT; no database contacted.');}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
