// Exercise the real create/update handlers and the already-shipped refusal reader.
// Database, session and SDK boundaries are explicit in-memory stand-ins; no live writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'apps/mobile/supabase/functions');
const CAPTION = '#fixture #nightlife';
function harness({ record = null, owner = true, session = true, failWrite = false } = {}) {
  const tables = {
    posts: [
      { id: 1, author_id: owner ? 1 : 2, post_kind: 'media', is_nsfw: false, content: CAPTION },
      // Profile-completion evidence for the signed-in fixture. Keep it
      // independent from the target post so the non-owner test can reach the
      // ownership check instead of being stopped by the mandatory first-post gate.
      { id: 99, author_id: 1, post_kind: 'text', is_nsfw: false, content: 'Existing member post' },
    ],
    identity_verifications: record ? [{ user_id: 'fixture-owner', ...record }] : [],
    verified_admission_policy: [{ id: 1, enforce: false }],
    user: [{ id: 'fixture-owner', createdAt: '2023-01-01T00:00:00Z', emailVerified: true, image: 'https://fixture.invalid/avatar.jpg' }],
    users: [{ id: 1, auth_id: 'fixture-owner', avatar_id: null }],
    posts_media: [{ _parent_id: 1, _order: 0, url: 'https://fixture.invalid/photo.jpg' }],
  };
  const writes = [];
  const db = { rpc: async () => ({ data: false, error: null }), from(table) {
    assert.ok(table in tables, 'Unexpected table ' + table);
    let filters = [], op = 'select', payload;
    const run = () => {
      let rows = tables[table].filter(r => filters.every(f => f(r)));
      if (op === 'update') {
        if (failWrite) return { data: null, error: { code: 'XX000', message: 'private database error' } };
        writes.push({ table, payload }); rows.forEach(r => Object.assign(r, payload));
      }
      if (op === 'insert') { rows = [{ id: 2, ...payload }]; tables[table].push(...rows); writes.push({ table, payload }); }
      return { data: rows, error: null };
    };
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      update(v) { op = 'update'; payload = v; return q; },
      insert(v) { op = 'insert'; payload = v; return q; },
      single: async () => { const r=run(); return { ...r, data:r.data?.[0] ?? null }; },
      maybeSingle: async () => { const r=run(); return { ...r, data:r.data?.[0] ?? null }; },
      limit() { return q; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    }; return q;
  } };
  let handler;
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const compiled = ts.transpileModule(fs.readFileSync(file,'utf8'), {
      compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 }, reportDiagnostics:true,
    });
    assert.equal((compiled.diagnostics || []).filter(d => d.category===ts.DiagnosticCategory.Error).length, 0);
    vm.runInNewContext(compiled.outputText, {
      exports:module.exports, module, Request, Response, URL, URLSearchParams, Date, crypto, TextEncoder, TextDecoder,
      console:{log(){},warn(){},error(){}},
      Deno:{env:{get:()=>'test'},serve:fn=>{handler=fn;}},
      require(name) {
        if (name.includes('supabase-js')) return {createClient:()=>db};
        if (name.endsWith('verify-session.ts')) return {verifySessionDetailed:async()=>session?{ok:true,userId:'fixture-owner'}:{ok:false,reason:'expired'}};
        if (name.endsWith('resolve-user.ts')) return {resolveOrProvisionUser:async()=>({id:1})};
        // This test only calls the pure refusal parser; the UI store is not exercised.
        if (name==='zustand') return {create:()=>({})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file),name));
        throw new Error('Unexpected import '+name);
      },
    },{filename:file});
    return module.exports;
  }
  return { tables,writes,load,async call(fn,body) {
    load(path.join(FUNCTIONS,fn,'index.ts'));
    const response=await handler(new Request('https://fixture.invalid/'+fn,{method:'POST',
      headers:{Authorization:'Bearer fixture-session','Content-Type':'application/json'},body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  } };
}
for (const fn of ['update-post','create-post']) {
  test(fn+': missing verification opens the existing prompt instead of a silent generic failure',async()=>{
    const h=harness();
    const r=await h.call(fn,{postId:1,content:CAPTION,isNSFW:true,media:[{type:'image',url:'https://fixture.invalid/a.jpg'}]});
    assert.equal(r.body.ok,false);
    assert.equal(r.body.error.code,'adult_verification_required','keep the existing wire error code');
    const {readAdmissionRefusal}=h.load(path.join(ROOT,'packages/app/lib/auth/verified-only-prompt.ts'));
    assert.equal(readAdmissionRefusal(r.body),'verification_required');
    assert.equal(h.writes.length,0,'no caption/media writes on refusal');
    assert.equal(h.tables.posts[0].content,CAPTION);
    assert.equal(h.tables.posts[0].is_nsfw,false);
  });
}
test('approved adult owner can save SPICY and caption without changing photos',async()=>{
  const h=harness({record:{status:'passed',date_of_birth:'1990-01-01'}});
  const r=await h.call('update-post',{postId:1,content:'Updated caption',isNSFW:true});
  assert.equal(r.body.ok,true,JSON.stringify(r));
  assert.equal(h.tables.posts[0].content,'Updated caption');
  assert.equal(h.tables.posts[0].is_nsfw,true);
  assert.equal(h.tables.posts_media[0].url,'https://fixture.invalid/photo.jpg');
});
test('ordinary caption editing remains allowed by the rollout policy',async()=>{
  const h=harness();const r=await h.call('update-post',{postId:1,content:'Updated caption'});
  assert.equal(r.body.ok,true);assert.equal(h.tables.posts[0].is_nsfw,false);
});
test('non-owner is still refused, even with approved verification',async()=>{
  const h=harness({owner:false,record:{status:'passed',date_of_birth:'1990-01-01'}});
  const r=await h.call('update-post',{postId:1,isNSFW:true});
  assert.equal(r.body.error.code,'forbidden');assert.equal(h.writes.length,0);
});
test('expired session is still refused before any write',async()=>{
  const h=harness({session:false});const r=await h.call('update-post',{postId:1,isNSFW:true});
  assert.equal(r.body.error.code,'unauthorized');assert.equal(h.writes.length,0);
});
test('underage document still blocks posting',async()=>{
  const h=harness({record:{status:'failed',date_of_birth:`${new Date().getUTCFullYear()-16}-01-01`,failure_code:'underage'}});
  const r=await h.call('update-post',{postId:1,isNSFW:true});
  assert.equal(r.body.ok,false);assert.equal(h.writes.length,0);
});
test('database write errors never become successful saves',async()=>{
  const h=harness({failWrite:true,record:{status:'passed',date_of_birth:'1990-01-01'}});
  const r=await h.call('update-post',{postId:1,isNSFW:true});
  assert.equal(r.body.ok,false);assert.equal(h.tables.posts[0].is_nsfw,false);
});
for (const [record, expected] of [
  [{status:'pending',date_of_birth:'1990-01-01'}, 'verification_incomplete'],
  [{status:'passed',date_of_birth:null,failure_code:'age_evidence_missing'}, 'age_evidence_missing'],
  [{status:'failed',failure_code:'duplicate_identity',failure_message:'Contact support about this verification.'}, null],
]) {
  test('verification state stays accurate: '+JSON.stringify(record),async()=>{
    const h=harness({record});
    const r=await h.call('update-post',{postId:1,content:'Edited',isNSFW:true});
    const {readAdmissionRefusal}=h.load(path.join(ROOT,'packages/app/lib/auth/verified-only-prompt.ts'));
    assert.equal(r.body.ok,false);assert.equal(readAdmissionRefusal(r.body),expected);
    assert.equal(h.writes.length,0);assert.equal(h.tables.posts[0].content,CAPTION);
  });
}
test('non-SPICY campaign and unrelated errors do not acquire a verification popup',()=>{
  const h=harness();const {readAdmissionRefusal}=h.load(path.join(ROOT,'packages/app/lib/auth/verified-only-prompt.ts'));
  assert.equal(readAdmissionRefusal({ok:false,error:{code:'adult_verification_required',message:'campaign-specific refusal'}}),null);
  assert.equal(readAdmissionRefusal({ok:false,error:{code:'forbidden',message:'not the author'}}),null);
});
test('refusal response never includes identity document details',()=>{
  const h=harness();const {spicyPostRefusal}=h.load(path.join(FUNCTIONS,'_shared/spicy-post-refusal.ts'));
  const body=spicyPostRefusal({state:'not_started',reason:null,retryable:true,message:null,providerRef:'private-provider-ref'});
  assert.equal(JSON.stringify(body).includes('private-provider-ref'),false);
  assert.equal(body.error.retryable,true);
});

for (const editor of [
  'packages/app/features/post/edit-post.web.tsx',
  'packages/app/features/routes/screens/(protected)/edit-post/[id].tsx',
]) {
  test(editor+': failed save shows the actionable message and keeps the draft',()=>{
    const filename=path.join(ROOT,editor);
    const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source)==='onError' && ts.isArrowFunction(node.initializer)) callback=node.initializer;
      ts.forEachChild(node,visit);
    }
    visit(source);assert.ok(callback,'editor must have its error callback');
    const compiled=ts.transpileModule('const callback = '+callback.getText(source)+'; callback;',{
      compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
    }).outputText;
    const toasts=[],writes=[];
    const onError=vm.runInNewContext(compiled,{Error,showToast:(...args)=>toasts.push(args),
      id:'1',postKeys:{detail:id=>['post',id],feedInfinite:nsfw=>['feed',nsfw]},
      useAppStore:{getState:()=>({nsfwEnabled:true})},queryClient:{setQueryData:(...args)=>writes.push(args)},
      // These must not be called when the server refuses a save.
      reset:()=>assert.fail('must not clear the draft'),router:{back:()=>assert.fail('must not dismiss editor')},
    });
    const message="Verify that you're 18 or older before posting SPICY content.";
    const snapshot={previousPost:{content:'old'},previousFeed:[{content:'old'}]};
    onError(new Error(message),{},snapshot);
    assert.equal(toasts[0][2],message,'do not discard the backend explanation');
    assert.equal(writes.length,2,'restore optimistic feed/detail caches');
    onError(null,{},null);
    assert.equal(toasts[1][2],"Couldn't save changes. Try again.");
  });
}
