const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function harness(options={}) {
  let handler, liked=!!options.liked, revoked=false;
  const writes=[], reads=[];
  const viewerId=options.owner?1:2;
  const db={
    async rpc(name,args) {
      assert.equal(name,'post_relationship_access');
      assert.equal(args.p_viewer,viewerId);
      return {data:options.failAccess?null:[{author_id:1,is_private:options.private!==false,is_following:!!options.approved&&!revoked,is_blocked:!!options.blocked,enforcement_ready:true}],error:options.failAccess?{message:'unavailable'}:null};
    },
    from(table) {
      const state={op:'select',filters:[]};reads.push(table);
      const run=()=>{
        if(state.op!=='select') {
          writes.push({table,op:state.op,filters:state.filters,payload:state.payload});
          if(table==='likes'){liked=state.op!=='delete';if(options.revokeOnWrite)revoked=true;}
          return {data:null,error:null};
        }
        if(table==='posts')return {data:options.missing?null:{id:42,author_id:1,visibility:options.visibility||'public',is_nsfw:options.spicy!==false,likes_count:913},error:options.failPost?{message:'unavailable'}:null};
        if(table==='likes')return {data:liked?{id:10}:null,error:null};
        if(table==='users')return {data:{id:viewerId,username:'viewer'},error:null};
        if(table==='verified_admission_policy')return {data:{denylist:options.denied?['viewer']:[]},error:null};
        if(table==='identity_verifications')return {data:options.minor?[{user_id:'viewer'}]:[],error:null};
        if(table==='push_tokens')return {data:[],error:null};
        throw Error('unexpected table '+table);
      };
      const q={
        select(){return q;},eq(key,value){state.filters.push([key,value]);return q;},gt(){return q;},limit(){return q;},
        insert(payload){state.op='insert';state.payload=payload;return q;},
        upsert(payload){state.op='upsert';state.payload=payload;return q;},delete(){state.op='delete';return q;},
        single:async()=>run(),maybeSingle:async()=>run(),then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);},
      };return q;
    },
  };
  function load(file){
    const exp={};
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{
      exports:exp,Response,console:{log(){},error(){},warn(){}},
      Deno:{env:{get:()=> 'fixture'},serve:fn=>{handler=fn;}},
      fetch:()=>{throw Error('must not push in synthetic fixtures');},
      require:name=>name.includes('supabase-js')?{createClient:()=>db}
        :name.endsWith('verify-session.ts')?{verifySessionDetailed:async()=>options.anonymous?{ok:false}:{ok:true,userId:'viewer'}}
        :name.endsWith('resolve-user.ts')?{resolveOrProvisionUser:async()=>({id:viewerId})}
        :name.endsWith('rate-limit.ts')?{checkRateLimit:()=>({allowed:true}),WRITE_LIMIT:{}}
        :name.endsWith('with-retry.ts')?{withRetry:async(fn)=>fn()}
        :load(path.resolve(path.dirname(file),name)),
    });return exp;
  }
  return {writes,reads,async call(name,body={postId:42}){
    load(path.join(root,name,'index.ts'));
    const res=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)}));
    return {status:res.status,body:await res.json(),cache:res.headers.get('cache-control')};
  }};
}
for(const fn of ['post-like','toggle-like']) {
  for(const [name,options] of [
    ['pending private',{}],['blocked approved',{approved:true,blocked:true}],['minor approved',{approved:true,minor:true}],
    ['denied approved',{approved:true,denied:true}],['public spicy nonfollower',{private:false}],
    ['private safe outsider',{spicy:false}],['missing post',{missing:true}],['failed post lookup',{failPost:true}],['failed access lookup',{failAccess:true}],
  ]) test(`${fn} refuses ${name} before any like or notification write`,async()=>{
    const h=harness(options),r=await h.call(fn,{postId:42,viewerId:1,userId:1,following:true});
    assert.equal(r.status,404);assert.equal(r.body.ok,false);assert.equal(r.body.error.code,'not_found');
    assert.deepEqual(h.writes,[]);assert.equal(r.body.data,undefined);assert.equal(r.cache,'private, no-store');
  });
  for(const [name,options] of [['approved',{approved:true}],['owner',{owner:true}],['public safe',{private:false,spicy:false}]])
    test(`${fn} permits ${name}`,async()=>{
      const h=harness(options),r=await h.call(fn);
      assert.equal(r.body.ok,true);assert.equal(r.body.data.liked,true);assert.equal(r.body.data.likesCount,913);assert.equal(r.body.data.countHidden,false);
      assert.ok(h.writes.some(w=>w.table==='likes'&&w.op!=='delete'));
    });
  test(`${fn} rechecks revocation after write before count/notification disclosure`,async()=>{
    const h=harness({approved:true,revokeOnWrite:true}),r=await h.call(fn);
    assert.equal(r.body.ok,true);assert.equal(r.body.data.likesCount,0);assert.equal(r.body.data.countHidden,true);
    assert.ok(!h.writes.some(w=>w.table==='notifications'));
  });
}
for(const fn of ['post-unlike','toggle-like']) {
  for(const options of [{},{blocked:true},{minor:true},{denied:true},{failAccess:true}])
    test(`${fn} permits only caller's own removal after revocation without disclosing total`,async()=>{
      const h=harness({...options,liked:true}),r=await h.call(fn);
      assert.equal(r.body.ok,true);assert.equal(r.body.data.liked,false);assert.equal(r.body.data.likesCount,0);assert.equal(r.body.data.countHidden,true);
      const deletes=h.writes.filter(w=>w.table==='likes');assert.equal(deletes.length,1);assert.equal(deletes[0].op,'delete');
      assert.deepEqual(deletes[0].filters,[['user_id',2],['post_id',42]]);
      assert.ok(!h.writes.some(w=>w.op==='insert'||w.op==='upsert'));
    });
}
test('post-unlike hidden or nonexistent post remains idempotent and never reveals counts',async()=>{
  const h=harness({missing:true});const r=await h.call('post-unlike');
  assert.equal(r.body.ok,true);assert.equal(r.body.data.liked,false);assert.equal(r.body.data.likesCount,0);assert.equal(r.body.data.countHidden,true);
});
for(const fn of ['post-like','post-unlike','toggle-like'])test(`${fn} rejects invalid IDs and anonymous callers before mutation`,async()=>{
  for(const postId of [-1,0,1.5,'42']){const h=harness({approved:true});assert.equal((await h.call(fn,{postId})).status,400);assert.deepEqual(h.writes,[]);}
  const h=harness({anonymous:true});assert.equal((await h.call(fn)).body.ok,false);assert.deepEqual(h.writes,[]);
});
