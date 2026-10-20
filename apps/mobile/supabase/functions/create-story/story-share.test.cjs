// Real edge handlers with isolated database/auth adapters. No HTTP or live data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const op = '00000000-0000-4000-8000-000000000001';
function load(file, adapters={}, globals={}) {
  const mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',...Object.keys(globals),code)(name=>{
    assert.ok(Object.hasOwn(adapters,name),`Unexpected dependency ${name}`); return adapters[name];
  },mod,mod.exports,...Object.values(globals));
  return mod.exports;
}
const shareHelpers=load('_shared/story-share.ts');
const overlayHelpers=load('_shared/overlay-sanitize.ts');
function createHarness({rpcData, rpcError, auth='fixture-user', admission='allowed'}={}) {
  const state={rpc:[],writes:[],session:auth,admission,story:null};
  let handler;
  const admin={
    async rpc(name,args){state.rpc.push({name,args});return {data:rpcData??{ok:true,story:{id:'99',sharedSource:{type:'post',id:'101'}},notification:{status:'sent'}},error:rpcError};},
    from(table){
      const q={
        insert(payload){state.writes.push({table,payload});return q},
        upsert(payload){return q.insert(payload)},select(){return q},delete(){return q},eq(){return q},
        async single(){return {data:table==='media'?{id:5}:{id:6,author_id:auth,created_at:'2026-01-01',expires_at:'2026-01-02',visibility:'public'},error:null}},
        then(resolve){resolve({error:null})},
      };return q;
    },
  };
  load('create-story/index.ts',{
    'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>admin},
    '../_shared/verify-session.ts':{verifySessionDetailed:async()=>state.session?{ok:true,userId:state.session}:{ok:false,reason:'invalid'}},
    '../_shared/resolve-user.ts':{resolveOrProvisionUser:async()=>({id:1,username:'sharer',first_name:'Sharer'})},
    '../_shared/verified-admission.ts':{resolveVerifiedAdmission:async()=>({state:state.admission}),admissionRefusal:()=>({code:'forbidden',message:'Not admitted'})},
    '../_shared/story-share.ts':shareHelpers,
    '../_shared/overlay-sanitize.ts':overlayHelpers,
  },{Deno:{serve:fn=>handler=fn,env:{get:()=> 'synthetic-only'}}});
  return {state,call:async(body,headers={Authorization:'Bearer fixture'})=>(await handler(new Request('https://fixture.invalid/create-story',{method:'POST',headers,body:JSON.stringify(body)}))).json()};
}

test('share request passes only verified identity + validated IDs; author/media/DM metadata cannot be spoofed',async()=>{
  const h=createHarness();
  const result=await h.call({sharedSource:{type:'event',id:'201',author:{id:'attendee'},title:'forged'},operationId:op,expectedViewerId:'1',mediaUrl:'https://evil.invalid/fake.jpg',mediaType:'video',senderId:'2',metadata:{type:'story_share'},storyOverlays:[{type:'text',content:'forged attribution'}]});
  assert.equal(result.ok,true); assert.deepEqual(h.state.rpc,[{name:'publish_story_share',args:{p_auth_id:'fixture-user',p_operation_id:op,p_source_type:'event',p_source_id:'201',p_visibility:'public',p_expected_viewer_id:'1'}}]);
  assert.deepEqual(h.state.writes,[],'atomic RPC is the only persistence path');
});

test('invalid identifiers/body/UUID/visibility fail before DB writes',async()=>{
  for(const body of [null,[],{sharedSource:null},{sharedSource:{type:'author',id:'1'},operationId:op},{sharedSource:{type:'post',id:101},operationId:op},{sharedSource:{type:'post',id:'-1'},operationId:op},{sharedSource:{type:'post',id:'1e2'},operationId:op},{sharedSource:{type:'post',id:'9007199254740993'},operationId:op},{sharedSource:{type:'post',id:'101'}},{sharedSource:{type:'post',id:'101'},operationId:'invalid'},{sharedSource:{type:'post',id:'101'},operationId:op,visibility:'private'}]) {
    const h=createHarness(); assert.equal((await h.call(body)).error.code,'validation_error'); assert.equal(h.state.rpc.length,0);assert.equal(h.state.writes.length,0);
  }
});

test('auth and verified-admission remain mandatory; RPC failures return failure without fallback publish/DM',async()=>{
  const body={sharedSource:{type:'post',id:'101'},operationId:op};
  for(const options of [{auth:null},{admission:'blocked'}]){const h=createHarness(options);assert.equal((await h.call(body)).ok,false);assert.equal(h.state.rpc.length,0)}
  const denied=createHarness({rpcData:{ok:false,code:'source_unavailable',message:'Unavailable'}});
  assert.equal((await denied.call(body)).error.code,'source_unavailable');assert.equal(denied.state.writes.length,0);
  const failed=createHarness({rpcError:{code:'XX000'}});
  assert.equal((await failed.call(body)).error.code,'internal_error'); assert.equal(failed.state.writes.length,0);
});

test('normal uploaded image/video story paths and overlays remain intact',async()=>{
  for(const mediaType of ['image','video']){
    const h=createHarness();
    const result=await h.call({mediaUrl:`https://fixture.invalid/story.${mediaType==='image'?'jpg':'mp4'}`,mediaType,storyOverlays:[{type:'text',content:'Original overlay',x:.5,y:.5}]});
    assert.equal(result.ok,true);assert.equal(result.data.story.mediaType,mediaType);assert.equal(h.state.rpc.length,0);
    assert.deepEqual(h.state.writes.map(x=>x.table),['media','stories','stories_stickers']);
  }
});

test('only reserved story_share notification type is refused',()=>{
  assert.equal(shareHelpers.hasReservedStoryShareMetadata({type:'story_share'}),true);
  for(const metadata of [undefined,null,{},[],{type:'post'},{type:'event'},{type:'story_reply'}]) assert.equal(shareHelpers.hasReservedStoryShareMetadata(metadata),false);
});

test('send-message refuses server-only share type before conversation or message mutation',async()=>{
  let handler;let writes=0;
  load('send-message/index.ts',{
    '../_shared/watch-notification.ts':{},
    './idempotency.ts':{},
    'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>({from(){writes++;throw Error('Should not touch DB')}})},
    '../_shared/verify-session.ts':{verifySessionDetailed:async()=>({ok:true,userId:'fixture'})},
    '../_shared/resolve-user.ts':{},
    '../_shared/rate-limit.ts':{checkRateLimit:()=>({allowed:true}),MESSAGE_LIMIT:{}},
    '../_shared/verified-admission.ts':{resolveVerifiedAdmission:async()=>({state:'allowed'})},
    '../_shared/story-share.ts':shareHelpers,
  },{Deno:{serve:fn=>handler=fn,env:{get:()=> 'synthetic-only'}}});
  const response=await handler(new Request('https://fixture.invalid/send-message',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({conversationId:1,content:'Spoof',metadata:{type:'story_share',storyId:'1'},operationId:op})}));
  assert.equal((await response.json()).error.code,'forbidden');assert.equal(writes,0);
});

test('deleting a shared story removes owned DB copies, never canonical source CDN bytes',async()=>{
  for(const isShare of [true,false]){
    let handler;const network=[];const deletes=[];
    const story={author_id:'fixture',media_id:5,thumbnail_id:6,...(isShare?{shared_source:{type:'post',id:'101'}}:{})};
    const media=[{id:5,url:'https://fixture.invalid/source.jpg',filename:null},{id:6,url:'https://fixture.invalid/thumb.jpg',filename:null}];
    const admin={from(table){let action='select';const q={select(){return q},eq(){return q},in(){return q},delete(){action='delete';deletes.push(table);return q},update(){action='update';return q},async single(){return {data:story}},then(resolve){resolve({data:table==='media'&&action==='select'?media:null,error:null})}};return q}};
    load('delete-story/index.ts',{
      'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>admin},
      '../_shared/verify-session.ts':{verifySessionDetailed:async()=>({ok:true,userId:'fixture'})},
    },{Deno:{serve:fn=>handler=fn,env:{get:()=> 'synthetic-only'}},fetch:async(url,options)=>{network.push({url,options});return new Response(null,{status:200})}});
    const response=await handler(new Request('https://fixture.invalid/delete-story',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({storyId:99})}));
    assert.equal((await response.json()).ok,true);
    assert.ok(deletes.includes('stories'));assert.ok(deletes.includes('media'));
    assert.equal(network.length,isShare?0:2);
  }
});

test('guarded replies bind expected viewer to verified send-token actor before membership or insert, while legacy sends still work',async()=>{
  async function send(extra) {
    let handler;const tables=[];const inserts=[];let inserted;
    const admin={from(table){tables.push(table);const q={
      select(){return q},eq(){return q},neq(){return q},is(){return q},update(){return q},upsert(){return q},
      insert(payload){inserts.push({table,payload});inserted={id:17,...payload,created_at:'2026-01-01T00:00:00Z'};return q},
      async single(){return {data:table==='conversations_rels'?{id:8}:table==='conversations'?{is_group:false}:inserted,error:null}},
      then(resolve){resolve({data:table==='conversations_rels'?[]:null,error:null})},
    };return q}};
    load('send-message/index.ts',{
      '../_shared/watch-notification.ts':{},'./idempotency.ts':{},
      'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>admin},
      '../_shared/verify-session.ts':{verifySessionDetailed:async()=>({ok:true,userId:'verified-send-token-account-A'})},
      '../_shared/resolve-user.ts':{resolveOrProvisionUser:async(_db,authId)=>{assert.equal(authId,'verified-send-token-account-A');return {id:1,username:'actor-A'}}},
      '../_shared/rate-limit.ts':{checkRateLimit:()=>({allowed:true}),MESSAGE_LIMIT:{}},
      '../_shared/verified-admission.ts':{resolveVerifiedAdmission:async()=>({state:'allowed'})},
      '../_shared/story-share.ts':shareHelpers,
    },{Deno:{serve:fn=>handler=fn,env:{get:()=> 'synthetic-only'}},fetch:()=>{throw Error('No external network allowed in edge fixture')}});
    const response=await handler(new Request('https://fixture.invalid/send-message',{method:'POST',headers:{Authorization:'Bearer token-A'},body:JSON.stringify({conversationId:1,content:'Story reply',operationId:op,...extra})}));
    return {body:await response.json(),tables,inserts};
  }
  const stale=await send({expectedViewerId:'2'});
  assert.equal(stale.body.error.code,'viewer_changed');assert.deepEqual(stale.tables,[]);assert.deepEqual(stale.inserts,[]);
  for(const expectedViewerId of [null,0,1,'','01','-1','user-A','9007199254740993']) {
    const invalid=await send({expectedViewerId});
    assert.equal(invalid.body.error.code,'validation_error');assert.deepEqual(invalid.tables,[]);assert.deepEqual(invalid.inserts,[]);
  }
  for(const extra of [{expectedViewerId:'1'},{}]) {
    const success=await send(extra);
    assert.equal(success.body.ok,true);assert.equal(success.body.data.message.senderId,'1');
    assert.equal(success.inserts.length,1);assert.equal(success.inserts[0].table,'messages');
    assert.equal(success.inserts[0].payload.sender_id,1);
    assert.equal(Object.hasOwn(success.inserts[0].payload,'expectedViewerId'),false,'guard is not stored in the message');
  }
});
