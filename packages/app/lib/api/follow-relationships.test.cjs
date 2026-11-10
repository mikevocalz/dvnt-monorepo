const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs');
function fixture(responses,{switchAt}={}){
 let revision=1,calls=0;
 const identity={authId:'a',viewerId:'1',revision:1};
 const exports={};
 const source=ts.transpileModule(fs.readFileSync(__dirname+'/follow-relationships.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',source)(name=>{
 if(name.endsWith('supabase/client'))return {supabase:{functions:{invoke:async(n,args)=>{assert.equal(n,'get-follow-relationships');assert.equal(args.body.expectedAuthId,'a');calls++;if(switchAt==='response')revision++;return responses.shift()}}}};
 if(name.endsWith('follow-identity'))return {getFollowIdentity:()=>identity,assertFollowIdentity:i=>{if(i.revision!==revision)throw new Error('Account changed')}};
 return {requireBetterAuthToken:async()=>{if(switchAt==='token')revision++;return 'token'}};
 },exports);
 return {api:exports,calls:()=>calls};
}
test('outgoing helper traverses blocked-only page and deduplicates',async()=>{
 const f=fixture([{data:{followingIds:[],nextCursor:200}},{data:{followingIds:[201,203],nextCursor:null}}]);
 assert.deepEqual(await f.api.getOwnFollowingIds(),[201,203]);assert.equal(f.calls(),2);
});
test('unknown, partial, nonadvancing and malformed responses reject',async()=>{
 for(const response of [{error:{}},{data:{}},{data:{followingIds:[1]}},{data:{followingIds:[],nextCursor:0}},{data:{followingIds:['2'],nextCursor:null}},{data:{followingIds:[5],nextCursor:3}}])
 await assert.rejects(fixture([response]).api.getOwnFollowingIds());
 for(const response of [{data:{relationships:[]}},{data:{relationships:[{targetId:2,isFollowing:true}]}},{error:{}}])
 await assert.rejects(fixture([response]).api.getOwnFollowRelationships([2]));
});
test('identity is rechecked after token and response awaits for both modes',async()=>{
 for(const switchAt of ['token','response'])for(const method of ['getOwnFollowingIds','getOwnFollowRelationships']){
 const f=fixture([{data:{followingIds:[],nextCursor:null,relationships:[]}}],{switchAt});
 await assert.rejects(f.api[method](...(method==='getOwnFollowRelationships'?[[]]:[])),/Account changed/);
 if(switchAt==='token')assert.equal(f.calls(),0);
 }
});
test('pairs validate requested targets and exact returned mapping',async()=>{
 const f=fixture([{data:{relationships:[{targetId:2,isFollowing:true,followsYou:false}]}}]);
 assert.deepEqual(await f.api.getOwnFollowRelationships([2]),[{targetId:2,isFollowing:true,followsYou:false}]);
 for(const ids of [[0],[2,2],Array.from({length:101},(_,i)=>i+1)]) await assert.rejects(f.api.getOwnFollowRelationships(ids));
});
