const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const {QueryClient}=require('@tanstack/react-query');
for(const base of ['packages/app','apps/mobile'])test(base+' hidden count never hydrates comment snapshots',async()=>{
 const client=new QueryClient();let mutation,state={user:{id:'1'}},reset=0;
 const auth=selector=>selector(state);auth.getState=()=>state;
 const source=ts.transpileModule(fs.readFileSync(base+'/lib/hooks/use-comment-like-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exp={};new Function('require','exports','__DEV__',source)(name=>{
  if(name==='react')return {useCallback:fn=>fn};
  if(name==='@tanstack/react-query')return {useQueryClient:()=>client,useQuery:o=>{if(client.getQueryData(o.queryKey)===undefined)client.setQueryData(o.queryKey,o.initialData);return {data:client.getQueryData(o.queryKey)}},useMutation:o=>{mutation=o;return {isPending:false,mutate(){throw Error('tombstone must block requests')}}}};
  if(name.includes('auth-store'))return {useAuthStore:auth};
  if(name.includes('ui-store'))return {useUIStore:{getState:()=>({showToast(){}})}};
  if(name.includes('api/comments'))return {commentsApi:{}};
  if(name.includes('reset-follow-access-caches'))return {resetFollowAccessCaches:async()=>reset++};
  if(name==='./use-comments')return {commentKeys:{byPost:id=>['comments',id],all:['comments']}};
  throw Error(name);
 },exp,false);
 let hook=exp.useCommentLikeState('3','9',72,true),m=mutation;
 const context=await m.onMutate({isLiked:true});
 m.onSuccess({liked:false,likes:0,countHidden:true},{},context);
 assert.equal(client.getQueryData(['commentLikeState','1','9']),null);assert.equal(reset,1);
 hook=exp.useCommentLikeState('3','9',72,true);
 assert.equal(hook.hasLiked,false);assert.equal(hook.likesCount,0);hook.toggle();hook.like();hook.unlike();
 // Normal allowed completion still updates an authoritative total.
 client.setQueryData(['commentLikeState','1','9'],{hasLiked:false,likesCount:72});
 exp.useCommentLikeState('3','9',72,false);m=mutation;
 const allowed=await m.onMutate({isLiked:false});m.onSuccess({liked:true,likes:73},{},allowed);
 assert.equal(client.getQueryData(['commentLikeState','1','9']).likesCount,73);
 const old=await m.onMutate({isLiked:true});state={user:{id:'2'}};
 m.onSuccess({liked:false,likes:0,countHidden:true},{},old);assert.equal(reset,1);
 client.clear();
});
for(const base of ['packages/app','apps/mobile'])test(base+' API preserves redaction flag',async()=>{
 const src=fs.readFileSync(base+'/lib/api/comments.ts','utf8');
 const method=src.split('  async likeComment(')[1].split('\n  /**')[0];
 const code=ts.transpileModule('export const api={async likeComment('+method+'};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exp={};new Function('exports','supabase','requireBetterAuthToken','console',code)(exp,{functions:{invoke:async()=>({data:{ok:true,data:{liked:false,likesCount:0,countHidden:true}}})}},async()=> 'fixture',{log(){},error(){}});
 assert.deepEqual(await exp.api.likeComment('9',true),{liked:false,likes:0,countHidden:true});
});
test('global reset tombstones all comment-like states without cache-only refetch',async()=>{
 const client=new QueryClient(),exp={};
 const code=ts.transpileModule(fs.readFileSync('packages/app/lib/hooks/reset-follow-access-caches.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',code)(()=>({resetPostAccessOverlays(){}}),exp);
 for(const id of ['9','10'])client.setQueryData(['commentLikeState','1',id],{likesCount:72,hasLiked:true});
 client.setQueryData(['comments','3'],[{id:'9',content:'protected'}]);
 await exp.resetFollowAccessCaches(client,false);
 for(const id of ['9','10'])assert.equal(client.getQueryData(['commentLikeState','1',id]),null);
 assert.equal(client.getQueryData(['comments','3']),undefined);client.clear();
});
for(const base of ['packages/app','apps/mobile'])test(base+' token-await identity change cannot dispatch a comment like',async()=>{
 const src=fs.readFileSync(base+'/lib/api/comments.ts','utf8');const method=src.split('  async likeComment(')[1].split('\n  /**')[0];
 const code=ts.transpileModule('export const api={async likeComment('+method+'};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let current=true,writes=0;const exp={};new Function('exports','supabase','requireBetterAuthToken','console',code)(exp,{functions:{invoke:async()=>{writes++;return {}}}},async()=>{current=false;return 'fixture'},{log(){},error(){}});
 await assert.rejects(exp.api.likeComment('9',true,()=>current),/Session changed/);assert.equal(writes,0);
});
