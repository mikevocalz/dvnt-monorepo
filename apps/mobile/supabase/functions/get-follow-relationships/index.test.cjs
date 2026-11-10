const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs');
function fixture({auth='auth-a',rows=[{following_id:2},{following_id:3}],access,fail,viewer=true}={}){
 let handler;const calls=[];
 const db={from(table){calls.push({table});const q={select(){return q},eq(k,v){calls.push({table,k,v});return q},gt(){return q},order(){return q},limit(){return q},in(){return q},maybeSingle:async()=>({data:viewer?{id:1}:null}),then(resolve){return Promise.resolve({data:table==='follows'?rows:[],error:fail?{}:null}).then(resolve)}};return q},
 rpc:async(name,args)=>{calls.push({name,args});return {data:access??args.p_authors.map(id=>({author_id:id,is_following:true,is_blocked:false})),error:fail?{}:null}}};
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports','Deno',source)(name=>name.includes('supabase-js')?{createClient:()=>db}:{verifySession:async()=>auth},{},{env:{get:()=> 'fixture'},serve:h=>handler=h});
 return {calls,async request(body={}){const response=await handler(new Request('https://fixture',{method:'POST',body:JSON.stringify({expectedAuthId:'auth-a',...body})}));return {status:response.status,body:await response.json()}}};
}
test('verified session owns all reads; rejects claimed viewer and account mismatch',async()=>{
 for(const body of [{viewerId:9},{userId:9},{followerId:9},{targetUserId:9}])assert.equal((await fixture().request(body)).status,400);
 assert.equal((await fixture({auth:null}).request()).status,401);
 assert.equal((await fixture().request({expectedAuthId:'other'})).status,409);
 const f=fixture();assert.equal((await f.request()).status,200);
 assert(f.calls.some(c=>c.k==='auth_id'&&c.v==='auth-a'));
 assert(f.calls.some(c=>c.k==='follower_id'&&c.v===1));
 assert.equal((await fixture({viewer:false}).request()).status,403);
});
test('pagination advances across blocked-only page, does not expose blocked edges',async()=>{
 const f=fixture({access:[{author_id:2,is_following:true,is_blocked:true}]});
 assert.deepEqual((await f.request({limit:1})).body,{followingIds:[],nextCursor:2});
 assert.deepEqual((await fixture().request()).body,{followingIds:[2,3],nextCursor:null});
});
test('invalid modes IDs and pagination rejected',async()=>{
 for(const body of [{mode:'all'},{limit:201},{cursor:-1},{cursor:1.1},{mode:'pairs',targetIds:[2,2]},{mode:'pairs',targetIds:[0]},{mode:'pairs',targetIds:Array.from({length:101},(_,i)=>i+1)},{targetIds:[2]}])
 assert.equal((await fixture().request(body)).status,400);
});
test('pairs return only viewer-relative flags and suppress both directions for blocks',async()=>{
 const f=fixture({rows:[{follower_id:2},{follower_id:3}],access:[{author_id:2,is_following:true,is_blocked:false},{author_id:3,is_following:true,is_blocked:true}]});
 assert.deepEqual((await f.request({mode:'pairs',targetIds:[2,3]})).body.relationships,[{targetId:2,isFollowing:true,followsYou:true},{targetId:3,isFollowing:false,followsYou:false}]);
 assert(f.calls.some(c=>c.k==='following_id'&&c.v===1));
});
test('DB errors and missing/partial relationship access fail rather than false follows',async()=>{
 for(const options of [{fail:true},{access:[]},{access:[{author_id:2}]}]){
 assert.equal((await fixture(options).request()).status,500);
 assert.equal((await fixture(options).request({mode:'pairs',targetIds:[2]})).status,500);
 }
});
