const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
function harness({authenticated=true,rpcError=false}={}){
 let handler; const calls=[]; const filters=[];
 const db={rpc:async(name,args)=>{calls.push({name,args});return rpcError?{error:{message:'missing migration'}}:{data:{following:false,followRequestStatus:'pending',notifyFollow:false}};},from(table){const q={select:()=>q,eq:(key,value)=>{filters.push({table,key,value});return q;},order:()=>q,limit:()=>q,single:async()=>({data:{username:'fixture',followers_count:0,following_count:0}}),then(resolve){return Promise.resolve({data:[]}).then(resolve);}};return q;}};
 const requireStub=name=>name.includes('supabase-js')?{createClient:()=>db}:name.includes('verify-session')?{verifySessionDetailed:async()=>authenticated?{ok:true,userId:'verified-actor'}:{ok:false}}:name.includes('resolve-user')?{resolveOrProvisionUser:async(_db,id)=>({id:id==='verified-actor'?1:2})}:{checkRateLimit:()=>({allowed:true})};
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno','console','fetch',source)(requireStub,{}, {serve:fn=>{handler=fn;},env:{get:()=> 'fixture'}},{log(){},error(){}},()=>{throw Error('No live notifications permitted');});
 return {calls,filters,async invoke(body,headers={Authorization:'Bearer fixture'}) { const response=await handler(new Request('https://offline.test',{method:'POST',headers,body:JSON.stringify(body)})); return response.json(); }};
}
test('verified caller overrides spoofed owner and pending never reports following',async()=>{
 const h=harness();const result=await h.invoke({targetUserId:2,action:'follow',userId:999,p_actor:999});
 assert.equal(result.data.following,false);assert.equal(result.data.followRequestStatus,'pending');
 assert.deepEqual(h.calls,[{name:'mutate_follow_relationship',args:{p_actor:1,p_target:2,p_action:'follow'}}]);
});
test('approval and inbox use only authenticated owner',async()=>{
 const h=harness();await h.invoke({targetUserId:4,action:'approve',ownerId:2});
 assert.equal(h.calls[0].args.p_actor,1);assert.equal(h.calls[0].args.p_target,4);
 await h.invoke({action:'requests',ownerId:2});
 assert.ok(h.filters.some(f=>f.table==='follow_requests'&&f.key==='following_id'&&f.value===1));
});
test('missing session, invalid action/target and failed RPC fail closed',async()=>{
 const denied=harness({authenticated:false});assert.equal((await denied.invoke({action:'follow',targetUserId:2})).ok,false);assert.equal(denied.calls.length,0);
 for(const body of [{targetUserId:2},{action:'approve',targetUserId:1},{action:'follow',targetUserId:1.5},{action:'follow',targetUserId:-1}]) {const h=harness();assert.equal((await h.invoke(body)).ok,false);assert.equal(h.calls.length,0);}
 const failed=harness({rpcError:true});assert.equal((await failed.invoke({action:'follow',targetUserId:2})).ok,false);
});
