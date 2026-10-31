const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Date, console: { warn() {}, error() {} },
    require: name => modules[name] ?? {},
  });
  return exports;
}
function storeFixture() {
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  return load('packages/app/lib/stores/offline-checkin-store.ts', {
    zustand: require('zustand'), 'zustand/middleware': require('zustand/middleware'),
    '@dvnt/app/lib/mmkv-zustand': { mmkvStorage: storage },
  });
}
function apiFixture(response, download = response) {
  const f = storeFixture();
  const auth = require('zustand/vanilla').createStore(()=>({user:{id:'11',authId:'staff'}}));
  const calls=[];
  const api = load('packages/app/lib/api/tickets.ts', {
    '../supabase/client': { supabase: { functions: { invoke: async (name,request) => { calls.push(request); return typeof response === 'function' ? response(request) : response; } } } },
    '../stores/auth-store': {useAuthStore:auth},
    '../auth/identity': { requireBetterAuthToken: async () => `synthetic-${auth.getState().user?.id}`,
      getCurrentUserRow: async () => auth.getState().user ? {id:Number(auth.getState().user.id),authId:auth.getState().user.authId} : null },
    './invoke-edge': { invokeEdge: async () => typeof download === 'function' ? download() : download },
    '../tickets/scan-verdict': load('packages/app/lib/tickets/scan-verdict.ts'),
    '@dvnt/app/lib/stores/offline-checkin-store': f,
  }).ticketsApi;
  return { ...f, api, auth, calls };
}
test('actual offline store rejects missing, expired and future timestamps independently for both rails', () => {
  const { useOfflineCheckinStore: store, OFFLINE_ALLOWLIST_MAX_AGE_MS: max } = storeFixture();
  const s = store.getState();
  s.setTokensForEvent('7', ['ticket']); s.setAddonTokensForEvent('7', ['addon']);
  assert.equal(s.isTokenValid('7','ticket'),true); assert.equal(s.isAddonTokenValid('7','addon'),true);
  assert.equal(s.isTokenValid('8','ticket'),false);
  store.setState({ lastDownloaded: { '7': new Date(Date.now()-max-1).toISOString() } });
  assert.equal(s.isTokenValid('7','ticket'),false); assert.equal(s.isAddonTokenValid('7','addon'),true);
  store.setState({ addonLastDownloaded: { '7': 'not-a-date' } });
  assert.equal(s.hasOfflineData('7'),false); assert.equal(s.isAddonTokenValid('7','addon'),false);
  store.setState({ lastDownloaded: { '7': new Date(Date.now()+10000).toISOString() } });
  assert.equal(s.isTokenValid('7','ticket'),false);
  store.setState({ lastDownloaded: {}, addonLastDownloaded: undefined });
  assert.equal(s.hasOfflineData('7'),false);
});
test('refresh keeps same-device duplicate knowledge and pending queue, but empty successful snapshot revokes tokens', () => {
  const { useOfflineCheckinStore: store } = storeFixture(); const s = store.getState();
  s.setTokensForEvent('7',['ticket']); s.markScannedOffline('7','ticket','staff'); s.markScannedOffline('7','ticket','staff');
  s.setTokensForEvent('7',[]);
  assert.equal(s.isTokenValid('7','ticket'),false); assert.equal(s.isAlreadyScanned('7','ticket'),true);
  assert.equal(store.getState().pendingScans.length,1);
});
for (const response of [{ error: { message: 'private error' } }, { data: { ok:false } }, {data:{ok:true, qr_tokens:null}}]) {
  test('failed or malformed download rejects without changing previous allowlist or freshness',async () => {
    const { api, useOfflineCheckinStore: store } = apiFixture(response); const s = store.getState();
    s.setTokensForEvent('7',['old']); s.setAddonTokensForEvent('7',['old-addon']);
    const before = JSON.stringify(store.getState());
    await assert.rejects(api.downloadOfflineTokens('7'));
    assert.equal(JSON.stringify(store.getState()),before);
  });
}
test('successful empty download clears addon snapshot and caller can revoke ticket snapshot',async () => {
  const { api, useOfflineCheckinStore: store } = apiFixture({data:{ok:true,qr_tokens:[],addon_qr_tokens:[]}});
  store.getState().setAddonTokensForEvent('7',['old']); store.getState().setTokensForEvent('7',['old']);
  const tokens = await api.downloadOfflineTokens('7'); store.getState().setTokensForEvent('7',tokens);
  assert.equal(store.getState().hasOfflineData('7'),false);
});
for (const data of [null, '{bad json', {valid:false,reason:'already_scanned'}, {valid:false,reason:'wrong_event'}, {valid:false,reason:'refunded'}, {valid:false,reason:'voided'}, {valid:false,reason:'server_error'}, {valid:false,reason:'unauthorized'}]) {
  test(`HTTP200 non-confirmed sync remains queued: ${JSON.stringify(data)}`,async () => {
    const { api } = apiFixture({data});
    const result = await api.syncOfflineScans([{qrToken:'synthetic',eventId:'7',scannedBy:'staff',scannedAt:'2026-01-01T00:00:00Z'}]);
    assert.deepEqual(Array.from(result.synced),[]); assert.deepEqual(Array.from(result.failed),['synthetic']);
  });
}
test('only positive server confirmation resolves queued scan',async () => {
  const { api } = apiFixture({data:{valid:true}});
  const result = await api.syncOfflineScans([{qrToken:'synthetic',eventId:'7',scannedBy:'staff',scannedAt:'2026-01-01T00:00:00Z'}]);
  assert.deepEqual(Array.from(result.synced),['synthetic']); assert.equal(result.failed.length,0);
});
for (const data of [null, '{bad json', {}, {valid:'yes'}]) test('malformed online response cannot trigger offline admission',async () => {
  const { api } = apiFixture({data}); const result = await api.scanTicket('synthetic','staff','7');
  assert.equal(result.valid,false); assert.equal(result.reason,'server_error');
});
test('transport outage still rejects for bounded offline fallback',async () => {
  const { api } = apiFixture({error:{name:'FunctionsFetchError'}});
  await assert.rejects(api.scanTicket('synthetic','staff','7'));
});
test('offline success title is explicitly provisional rather than confirmed admission', () => {
  const {scanVerdictTitle} = load('packages/app/lib/tickets/scan-verdict.ts');
  assert.equal(scanVerdictTitle('success','offline_pending'), 'Provisional offline — pending sync');
  assert.equal(scanVerdictTitle('success',null),'Admitted — let them in');
});
test('lost confirmation never falsely claims the server did not check in; cancelled events have explicit refusal', () => {
  const {scanVerdictTitle, scanVerdictMessage} = load('packages/app/lib/tickets/scan-verdict.ts');
  for (const reason of ['network_error','server_error']) {
    assert.match(scanVerdictMessage(reason), /may have completed/);
    assert.doesNotMatch(scanVerdictMessage(reason), /NOT checked/);
    assert.match(scanVerdictTitle('no_verdict',reason), /outcome unknown/);
  }
  assert.match(scanVerdictMessage('event_cancelled'), /event has been cancelled/);
  assert.match(scanVerdictTitle('rejected','event_cancelled'), /Event cancelled/);
});
test('mounted web verdict distinguishes provisional from confirmed; unresolved sync stays visible online', async () => {
  const React = require('react');
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  const old = { window: global.window, document: global.document, navigator: Object.getOwnPropertyDescriptor(global,'navigator') };
  global.window = window; global.document = window.document;
  Object.defineProperty(global,'navigator',{value:window.navigator,configurable:true});
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const {createRoot} = require('react-dom/client');
  const source = fs.readFileSync(path.join(root,'packages/app/features/events/scanner.web.tsx'),'utf8');
  const selected = source.slice(source.indexOf('function ScanResultOverlay('),source.indexOf('// ── RecentScans')) +
    source.slice(source.indexOf('function DoorSyncRow('),source.indexOf('// ── EventScannerScreen'));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(selected+'\nexports.Overlay=ScanResultOverlay;exports.Sync=DoorSyncRow;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText,{exports,require,Date,
    scanVerdictTitle:load('packages/app/lib/tickets/scan-verdict.ts').scanVerdictTitle,
    CheckCircle2:()=>null,AlertTriangle:()=>null,XCircle:()=>null,
    DismissOverlayButton:({onPress})=>React.createElement('button',{onClick:onPress},'Dismiss'),
  });
  const host = document.createElement('div');document.body.appendChild(host);const mounted=createRoot(host);
  let dismissed=0;
  try {
    await React.act(async()=>mounted.render(React.createElement(exports.Overlay,{result:{type:'success',reason:'offline_pending',message:'Server confirmation pending'},onDismiss:()=>dismissed++})));
    assert.match(host.textContent,/Provisional offline — pending sync/);assert.doesNotMatch(host.textContent,/Admitted — let them in/);
    await React.act(async()=>host.querySelector('button').click());assert.equal(dismissed,1);
    await React.act(async()=>mounted.render(React.createElement(exports.Overlay,{result:{type:'success'},onDismiss:()=>{}})));
    assert.match(host.textContent,/Admitted — let them in/);
    await React.act(async()=>mounted.render(React.createElement(exports.Sync,{phase:'online',queued:2,listUpdatedAt:Date.now()})));
    assert.match(host.textContent,/2 scans need sync or staff review — not confirmed/);assert.doesNotMatch(host.textContent,/list updated just now/);
    await React.act(async()=>mounted.render(React.createElement(exports.Sync,{phase:'synced',queued:1,listUpdatedAt:Date.now()})));
    assert.match(host.textContent,/1 scan needs sync or staff review — not confirmed/);
  } finally {
    await React.act(async()=>mounted.unmount());window.happyDOM.abort();
    global.window=old.window;global.document=old.document;
    if(old.navigator)Object.defineProperty(global,'navigator',old.navigator);else delete global.navigator;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});
for (const file of [
  'packages/app/features/events/organizer.web.tsx',
  'packages/app/features/routes/screens/(protected)/events/[id]/organizer.tsx',
  'packages/app/features/routes/screens/(protected)/events/[id]/index.tsx',
]) test(`actual offline download handler clears authoritative empty snapshot: ${file}`, async () => {
  const source = ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if(ts.isVariableStatement(node) && node.declarationList.declarations.some(d=>['handleDownloadForOffline','handleDownloadOffline'].includes(d.name.getText(source))))declaration=node;
    ts.forEachChild(node,visit);
  }
  visit(source);assert.ok(declaration);
  const name=declaration.declarationList.declarations[0].name.getText(source);
  const {api,useOfflineCheckinStore: store}=apiFixture({data:{ok:true,qr_tokens:[],addon_qr_tokens:[]}});store.getState().setTokensForEvent('7',['old']);
  const exports={};
  const context={exports,useCallback:fn=>fn,eventId:'7',offlineStore:store.getState(),offlineCheckin:store.getState(),
    ticketsApi:api,showToast(){},setDownloading(){},setIsDownloading(){},console};
  vm.runInNewContext(ts.transpileModule(declaration.getText(source)+`\nexports.run=${name};`,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,context);
  await exports.run();assert.equal(store.getState().isTokenValid('7','old'),false);
});
for (const status of [401,403,404,409]) test(`authoritative download refusal ${status} revokes both allowlists without discarding admission audit`,async()=>{
  const {api,useOfflineCheckinStore:store}=apiFixture({error:{status,message:'refused'}});const s=store.getState();
  s.setTokensForEvent('7',['ticket']);s.setAddonTokensForEvent('7',['addon']);s.markScannedOffline('7','queued','staff');
  await assert.rejects(api.downloadOfflineTokens('7'));
  assert.equal(s.isTokenValid('7','ticket'),false);assert.equal(s.isAddonTokenValid('7','addon'),false);assert.equal(s.hasOfflineData('7'),false);
  assert.equal(store.getState().pendingScans.length,1);assert.equal(s.isAlreadyScanned('7','queued'),true);
});
for(const response of [{data:{valid:false,reason:'event_cancelled'}},{error:{context:{status:403}}}])test('authoritative online scan refusal revokes cached admission but retains pending scans',async()=>{
  const {api,useOfflineCheckinStore:store}=apiFixture(response);const s=store.getState();
  s.setTokensForEvent('7',['ticket']);s.setAddonTokensForEvent('7',['addon']);s.markScannedOffline('7','queued','staff');
  const result=await api.scanTicket('ticket','staff','7');assert.equal(result.valid,false);
  assert.equal(s.hasOfflineData('7'),false);assert.equal(store.getState().pendingScans.length,1);assert.equal(s.isAlreadyScanned('7','queued'),true);
});
test('reconciliation cancellation revokes local admission evidence while retaining failed queue',async()=>{
  const {api,useOfflineCheckinStore:store}=apiFixture({data:{valid:false,reason:'event_cancelled'}});const s=store.getState();
  s.setTokensForEvent('7',['ticket']);s.markScannedOffline('7','ticket','staff');
  const result=await api.syncOfflineScans(store.getState().pendingScans);
  assert.equal(s.hasOfflineData('7'),false);assert.equal(result.failed.length,1);assert.equal(store.getState().pendingScans.length,1);
});
for (const reason of ['refunded','voided','transfer_pending','ticket_not_found','wrong_event','already_scanned'])test(`known rejected token ${reason} cannot later admit offline, while other tickets and audit remain`,async()=>{
  const {api,useOfflineCheckinStore:store}=apiFixture({data:{valid:false,reason}});const s=store.getState();
  s.setTokensForEvent('7',['rejected','other']);s.markScannedOffline('7','queued','staff');
  await api.scanTicket('rejected','staff','7');
  assert.equal(s.isTokenValid('7','rejected'),false);assert.equal(s.isTokenValid('7','other'),true);assert.equal(store.getState().pendingScans.length,1);
});
test('late allowlist download cannot resurrect tokens after authoritative cancellation',async()=>{
  let resolve;const waiting=new Promise(r=>resolve=r);
  const {api,useOfflineCheckinStore:store}=apiFixture({data:{valid:false,reason:'event_cancelled'}},()=>waiting);
  store.getState().setTokensForEvent('7',['old']);
  const download=api.downloadOfflineTokens('7');
  await api.scanTicket('old','staff','7');
  resolve({data:{ok:true,qr_tokens:['stale'],addon_qr_tokens:['stale-addon']}});
  await assert.rejects(download,/superseded/);assert.equal(store.getState().hasOfflineData('7'),false);
});
test('newer allowlist refresh wins when responses finish out of order',async()=>{
  let resolve;const waiting=new Promise(r=>resolve=r);let calls=0;
  const {api,useOfflineCheckinStore:store}=apiFixture({},()=>++calls===1?waiting:{data:{ok:true,qr_tokens:['current'],addon_qr_tokens:['current-addon']}});
  const old=api.downloadOfflineTokens('7');const fresh=await api.downloadOfflineTokens('7');store.getState().setTokensForEvent('7',fresh);
  resolve({data:{ok:true,qr_tokens:['old'],addon_qr_tokens:['old-addon']}});
  await assert.rejects(old,/superseded/);assert.equal(store.getState().isTokenValid('7','current'),true);assert.equal(store.getState().isAddonTokenValid('7','old-addon'),false);
});
test('B cannot replay A scans; A returning can sync own numeric or auth identity only',async()=>{
  const {api,auth,calls}=apiFixture({data:{valid:true}});
  const scans=[{qrToken:'A',eventId:'7',scannedBy:'staff',scannedAt:'2026-01-01T00:00:00Z'},{qrToken:'legacy-unknown',eventId:'7',scannedAt:'2026-01-01T00:00:00Z'}];
  auth.setState({user:{id:'12',authId:'staff-b'}});
  const b=await api.syncOfflineScans(scans);assert.equal(b.synced.length,0);assert.equal(calls.length,0);
  auth.setState({user:{id:'11',authId:'staff'}});
  const a=await api.syncOfflineScans(scans);assert.deepEqual(Array.from(a.synced),['A']);assert.deepEqual(Array.from(a.failed),['legacy-unknown']);
  assert.equal(calls.length,1);assert.equal(calls[0].headers['x-auth-token'],'synthetic-11');assert.equal(calls[0].body.scanned_by,'staff');
});
for(const back of [false,true])test(`mid-flight account switch${back?' A→B→A':''} cannot acknowledge old queue or dispatch next scan`,async()=>{
  let resolve;const waiting=new Promise(r=>resolve=r);const {api,auth,calls}=apiFixture(()=>waiting);
  const scans=['first','second'].map(qrToken=>({qrToken,eventId:'7',scannedBy:'11',scannedAt:'2026-01-01T00:00:00Z'}));
  const task=api.syncOfflineScans(scans);
  while(calls.length===0)await Promise.resolve();
  auth.setState({user:{id:'12',authId:'staff-b'}});if(back)auth.setState({user:{id:'11',authId:'staff'}});
  resolve({data:{valid:true}});const result=await task;
  assert.equal(result.synced.length,0);assert.equal(result.failed.length,2);assert.equal(calls.length,1);
});
test('atomic download commit cannot be resurrected by awaiting caller after cancellation',async()=>{
  const {api,useOfflineCheckinStore:store}=apiFixture({data:{valid:false,reason:'event_cancelled'}},{data:{ok:true,qr_tokens:['old'],addon_qr_tokens:[]}});
  const tokens=await api.downloadOfflineTokens('7');assert.equal(tokens[0],'old');assert.equal(store.getState().isTokenValid('7','old'),true);
  await api.scanTicket('old','staff','7');
  // All real caller handlers now only report the returned count; none writes it.
  assert.equal(store.getState().isTokenValid('7','old'),false);
  for(const file of ['packages/app/features/events/door-offline-kit.web.ts','packages/app/features/events/organizer.web.tsx','packages/app/features/routes/screens/(protected)/events/[id]/organizer.tsx','packages/app/features/routes/screens/(protected)/events/[id]/index.tsx']){
    assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/setTokensForEvent\(eventId, tokens\)/);
  }
});
