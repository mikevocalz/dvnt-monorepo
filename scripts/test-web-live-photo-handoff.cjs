// Real React component/draft helpers; API, auth and IndexedDB adapter mocked.
// This does not prove physical Safari/app handoff or production deployment.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
(async () => {
 const {Window} = await import(require.resolve('happy-dom'));
 const window = new Window();
 Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const React=require('react'), {createRoot}=require('react-dom/client');
 const base = () => ({selectedMedia:[],caption:'saved caption',textSlides:[],activeTextSlideIndex:0,location:'',locationData:null,taggedPeople:[],tags:[],placedTags:[],isNSFW:false,postKind:'media',textTheme:'graphite',step:'select'});
 let auth, draft, changes, pending, stored, hooks, calls;
 const authStore = selector => selector(auth);
 authStore.getState=()=>auth;
 const draftStore={getState:()=>draft,setState:value=>{changes++;draft={...draft,...value};}};
 const storage={
  loadHandoffDraft: owner=>hooks.load ? hooks.load(owner) : Promise.resolve(stored?.ownerId===owner?stored:null),
  saveHandoffDraft: async record=>{calls.saves.push(record); if(hooks.save) await hooks.save(record);stored=record;},
  deleteHandoffDraft: async (owner,id)=>{calls.deletes.push([owner,id]);stored=null;},
 };
 const handoff=(state='pending')=>({id:'11111111-1111-4111-8111-111111111111',draftId:'22222222-2222-4222-8222-222222222222',state,maxCount:10,expiresAt:new Date(Date.now()+900000).toISOString()});
 const assets=[{photoId:1,motionId:2,url:'https://cdn.example/a.heic',livePhotoVideoUrl:'https://cdn.example/a.mov',mimeType:'image/heic'}];
 const api={
  create:async(id,maxCount)=>{calls.creates++;if(hooks.create)await hooks.create(id);return {...handoff(),draftId:id,maxCount};},
  status:async()=>({...stored.handoff}),
  consume:async(...args)=>{calls.consumes.push(args);return hooks.consume?hooks.consume(...args):{...stored.handoff,state:'consumed',assets};},
  cancel:async()=>{calls.cancels++;throw Error('Expired server refuses cancel');},
 };
 const adapters={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'../../lib/stores/auth-store':{useAuthStore:authStore},'../../lib/stores/create-post-store':{useCreatePostStore:draftStore},'../../lib/api/live-photo-handoff':{livePhotoHandoffApi:api},'./live-photo-handoff-storage.web':storage};
 const modules=new Map();
 function load(filename){
  if(modules.has(filename))return modules.get(filename).exports;
  const mod=new Module(filename,module);modules.set(filename,mod);
  mod.require=name=>{if(name in adapters)return adapters[name];if(name.startsWith('.'))return load(path.resolve(path.dirname(filename),name+'.ts'));throw Error('Unexpected import '+name);};
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,filename);return mod.exports;
 }
 const {NativeLivePhotoHandoff}=load(path.resolve(__dirname,'../packages/app/features/create/native-live-photo-handoff.web.tsx'));
 let root,node;
 const notify=value=>{pending=value;};
 const render=()=>React.act(async()=>root.render(React.createElement(NativeLivePhotoHandoff,{disabled:false,onPendingChange:notify})));
 const reset=async(record=null)=>{
  if(root)await React.act(async()=>root.unmount());
  auth={user:{id:'alice',authId:'alice'}};draft=base();changes=0;pending=false;stored=record;hooks={};calls={saves:[],deletes:[],consumes:[],creates:0,cancels:0};
  node=document.createElement('div');document.body.replaceChildren(node);root=createRoot(node);
 };
 const button=text=>[...node.querySelectorAll('button')].find(el=>el.textContent.includes(text));
 const click=async text=>React.act(async()=>{const el=button(text);assert.ok(el,'button '+text);assert.equal(el.disabled,false);el.click();});
 const confirm=async()=>{await click('Restore');await React.act(async()=>{const checkbox=node.querySelector('input[type=checkbox]');assert.ok(checkbox);checkbox.click();});};
 const record=()=>({ownerId:'alice',draftId:handoff().draftId,requestId:'33333333-3333-4333-8333-333333333333',savedAt:Date.now(),draft:base(),blobs:{},handoff:handoff('ready')});

 await reset(); const initial=deferred();hooks.load=()=>initial.promise;await render();assert.equal(button('Add Live').disabled,true,'initial backup load gates start');await React.act(async()=>initial.resolve(null));assert.equal(button('Add Live').disabled,false);
 hooks.save=async()=>{throw Error('Storage quota exceeded');};await click('Add Live');assert.equal(calls.creates,0);assert.equal(node.querySelector('a'),null,'no app link before successful durable save');assert.match(node.textContent,/quota/);

 await reset();await render();const saving=deferred();hooks.save=()=>saving.promise;
 await React.act(async()=>{button('Add Live').click();assert.equal(pending,true,'pending callback fires synchronously before await');});
 auth={user:{id:'bob',authId:'bob'}};await render();await React.act(async()=>saving.resolve());assert.equal(calls.creates,0,'owner switch cannot create old handoff');assert.equal(changes,0);assert.equal(button('Add Live').disabled,false,'new owner not left busy');assert.equal(node.querySelector('a'),null);

 await reset();await render();let createFailed=true;hooks.create=async()=>{if(createFailed)throw Error('offline create');};await click('Add Live');const originalDraftId=stored.draftId;assert.ok(button('Retry app pickup'));assert.equal(node.querySelector('a'),null);createFailed=false;await click('Retry app pickup');assert.equal(stored.draftId,originalDraftId,'retry create preserves durable draft identity');assert.equal(calls.creates,2);assert.ok(node.querySelector('a'));

 await reset(record());await render();await confirm();const consuming=deferred();hooks.consume=()=>consuming.promise;await click('Restore');draft={...draft,caption:'new edit during request'};await React.act(async()=>consuming.resolve({...handoff('consumed'),assets}));assert.equal(changes,0,'async restore cannot overwrite concurrent editor changes');assert.equal(draft.caption,'new edit during request');assert.match(node.textContent,/changed while receiving/);

 await reset(record());await render();await confirm();const ownerConsume=deferred();hooks.consume=()=>ownerConsume.promise;await click('Restore');auth={user:{id:'bob',authId:'bob'}};draft={...base(),caption:'bob private draft'};await render();await React.act(async()=>ownerConsume.resolve({...handoff('consumed'),assets}));assert.equal(changes,0);assert.equal(calls.saves.length,0,'old owner consumption never persists into new owner');assert.equal(draft.caption,'bob private draft');assert.equal(button('Add Live').disabled,false);

 const expired=record();expired.handoff.expiresAt=new Date(Date.now()-1000).toISOString();await reset(expired);await render();await click('Cancel app');assert.equal(calls.cancels,0,'expired handoff discard needs no impossible server cancel');assert.deepEqual(calls.deletes,[['alice',expired.draftId]]);assert.equal(button('Add Live').disabled,false);

 await reset(record());await render();await confirm();let fail=true;hooks.save=async()=>{if(fail)throw Error('quota after consume');};await click('Restore');assert.equal(changes,0);assert.equal(calls.consumes.length,1);fail=false;await click('Restore');assert.equal(calls.consumes.length,2);assert.deepEqual(calls.consumes[0],calls.consumes[1],'lost durable save retries exact consume request ID');assert.equal(changes,1);assert.equal(draft.selectedMedia.length,1);assert.equal(draft.selectedMedia[0].handoffUpload.ownerId,'alice');assert.equal(pending,false);assert.match(node.textContent,/choose Share/);
 await React.act(async()=>root.unmount());await window.happyDOM.close();
 // Real IndexedDB transaction adapter against fake-indexeddb, not the component mock.
 const {indexedDB}=require('fake-indexeddb');global.indexedDB=indexedDB;
 let resetStorage;
 adapters['../../lib/utils/storage']={registerUserDataReset:callback=>{resetStorage=callback;}};
 const db=load(path.resolve(__dirname,'../packages/app/features/create/live-photo-handoff-storage.web.ts'));
 const first=record(), second={...record(),draftId:'44444444-4444-4444-8444-444444444444'};
 await db.saveHandoffDraft(first);
 await assert.rejects(db.saveHandoffDraft(second),'another tab must not replace backup');
 assert.equal((await db.loadHandoffDraft('alice')).draftId,first.draftId);
 await assert.rejects(db.deleteHandoffDraft('alice',second.draftId),'another tab must not delete backup');
 assert.equal((await db.loadHandoffDraft('alice')).draftId,first.draftId);
 const complete={...first,applied:true};await db.saveHandoffDraft(complete);assert.equal((await db.loadHandoffDraft('alice')).applied,true);
 assert.equal(await db.loadHandoffDraft('bob'),null,'owner isolation');
 await db.deleteHandoffDraft('alice',first.draftId);
 const results=await Promise.allSettled([db.saveHandoffDraft(first),db.saveHandoffDraft(second)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1,'concurrent different-draft saves serialize');
 const winner=await db.loadHandoffDraft('alice');assert.ok([first.draftId,second.draftId].includes(winner.draftId));
 await db.deleteHandoffDraft('alice',winner.draftId);
 await db.saveHandoffDraft({...first,savedAt:Date.now()-25*3600*1000});assert.equal(await db.loadHandoffDraft('alice'),null,'retention expires backup');
 await db.saveHandoffDraft(first);resetStorage();
 // New load opens after reset clear transaction request and observes cleared storage.
 assert.equal(await db.loadHandoffDraft('alice'),null,'user-data reset clears saved backup');
 console.log('Real storage adapter tests passed: different-draft write/delete CAS, concurrent saves, owner isolation, retention, reset. IndexedDB engine is fake-indexeddb.');
 console.log('Web handoff React lifecycle passed: load gate, save failure, synchronous pending, owner-switch save/consume, concurrent edit preservation, expired discard, idempotent consume retry. API/storage/auth are mocked; no post is published.');
})().catch(error=>{console.error(error);process.exitCode=1;process.exit(1);});
