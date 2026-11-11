const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function harness(o={}) {
 let handler,writes=[],reads=0,revoked=false;
 const db={rpc:async(name)=>({data:[{author_id:2,is_private:!!o.private,is_following:!o.denied&&!revoked,is_blocked:!!o.blocked,enforcement_ready:true}]}),from(table){
  let action='read'; const q={select(){return q},eq(){return q},delete(){action='delete';return q},insert(){action='insert';return q},maybeSingle(){return q},single(){return q},then(resolve,reject){
   let r={data:null,error:null};
   if(action!=='read'){writes.push(action);if(o.revokeAfterWrite)revoked=true;if(o.duplicate)r.error={code:'23505'};}
   else if(table==='comment_likes')r=o.lookupError?{error:{message:'bad'}}:{data:o.existing?{user_id:1}:null};
   else if(table==='comments'){reads++;r={data:o.missing?null:{id:9,post_id:o.orphan?null:3,likes_count:72}};}
   else if(table==='posts')r={data:o.missingParent?null:{id:3,author_id:2,visibility:o.visibility||'public',is_nsfw:false}};
   return Promise.resolve(r).then(resolve,reject);
  }};return q;
 }};
 const cache={};function load(file){if(cache[file])return cache[file];const exp={};cache[file]=exp;
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','Deno','Response','console',code)(name=>{
   if(name.includes('supabase-js'))return {createClient:()=>db};
   if(name.includes('verify-session'))return {verifySessionDetailed:async()=>o.signedOut?{ok:false}:{ok:true,userId:'auth-1'}};
   if(name.includes('resolve-user'))return {resolveOrProvisionUser:async()=>({id:1})};
   if(name.includes('spicy-access'))return {viewerMaySeeSpicy:async()=>false};
   return load(path.resolve(path.dirname(file),name));
  },exp,{env:{get:()=> 'test'},serve:fn=>handler=fn},Response,{log(){},warn(){},error(){}});return exp;}
 load(path.join(__dirname,'index.ts'));
 return {writes,async run(like,commentId=9){const r=await handler(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({commentId,like})}));return {headers:r.headers,body:await r.json()};}};
}
for(const o of [{private:true,denied:true},{blocked:true},{visibility:'private'},{orphan:true},{missing:true},{missingParent:true}])test('denies new like '+JSON.stringify(o),async()=>{const h=harness(o);assert.equal((await h.run(true)).body.ok,false);assert.deepEqual(h.writes,[])});
for(const existing of [false,true])test('hidden idempotent unlike does not expose count '+existing,async()=>{const h=harness({private:true,denied:true,existing});const r=await h.run(false);assert.equal(r.body.data.countHidden,true);assert.equal(r.body.data.likesCount,0);assert.equal(r.body.data.liked,false);assert.deepEqual(h.writes,existing?['delete']:[]);});
for(const o of [{},{existing:true},{duplicate:true},{revokeAfterWrite:true,private:true}])test('allowed and raced completion '+JSON.stringify(o),async()=>{const h=harness(o);const r=await h.run(true);assert.equal(r.body.ok,true);assert.equal(r.body.data.likesCount,o.revokeAfterWrite?0:72);assert.equal(r.body.data.countHidden, o.revokeAfterWrite?true:undefined);assert.equal(r.headers.get('cache-control'),'private, no-store');});
for(const id of [-1,1.5,0,'9'])test('invalid id '+id,async()=>{const h=harness();assert.equal((await h.run(true,id)).body.ok,false);assert.deepEqual(h.writes,[])});
test('lookup failure does not write',async()=>{const h=harness({lookupError:true});assert.equal((await h.run(true)).body.ok,false);assert.deepEqual(h.writes,[])});
test('signed out denied',async()=>{const h=harness({signedOut:true});assert.equal((await h.run(true)).body.ok,false);assert.deepEqual(h.writes,[])});
