#!/usr/bin/env node
// Mount production editors and overflow actions offline. Only platform/network
// adapters are mocked; role predicates, edit store, JSX and handlers are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {createRoot} = require('react-dom/client');
const ROOT = path.resolve(__dirname, '..');
const noop = () => {};
const showToast=(...args)=>state.toasts?.push(args);
const state = { role: 'editor', resolved: true, pending: false, paused: false, error: false, authenticated: true, saves: [], navigations: [], bankChecks: 0 };
const event = {id:'7', title:'Co-host event', description:'Details', fullDate:'2026-12-11T22:00:00Z', eventTz:'UTC', host:{id:'different-owner-id'}, price:20, ticketingEnabled:true, visibility:'public'};
const auth = {user:{id:'cohost', authId:'cohost'}, isAuthenticated:true};
const disturbSession = () => {
 if(!state.switchAccountOnUpload)return;
 auth.user={id:'other',authId:'other'};state.epoch=(state.epoch??1)+1;
 if(state.returnToAccount){auth.user={id:'cohost',authId:'cohost'};state.epoch++;}
};
const useAuthStore = selector => selector({...auth, isAuthenticated:state.authenticated});
useAuthStore.subscribe = () => noop;
useAuthStore.getState = () => auth;
const router = {push:p=>state.navigations.push(p), replace:p=>state.navigations.push(p), back:()=>state.navigations.push('back')};
const mutation = {isPending:false, mutateAsync:async value=>{state.saves.push(value);if(state.eventFailure)throw Error('No row updated');}};
const queryClient = {invalidateQueries:async()=>{},setQueryData:noop};
const tier = {id:'tier-7',name:'General Admission',category:'admission',price_cents:2000,quantity_total:100,max_per_user:4,is_active:true};
const ticketTypesApi = {getByEvent:async()=>{if(state.tierLoadFailure)throw Error('catalog unavailable');return [tier];},create:async params=>{state.tierCreates?.push(params);if(state.deferTierCreate)await new Promise(resolve=>{state.finishTierCreate=resolve;});return {id:'new'};},update:async(...args)=>{state.tierWrites?.push(args);if(state.tierFailure)throw Error('No row updated');return true;},deactivate:async()=>true};
const mediaPicker = {pickFromLibrary:async()=>[{uri:'file:///new-flyer.jpg',type:'image'}],requestPermissions:noop};
const colors = new Proxy({}, {get:()=> '#fff'});
const dom = tag => function Component({children,onPress,onChangeText,...props}) {
  const safe = {};
  for (const name of ['disabled','type','value','placeholder']) if(props[name]!==undefined)safe[name]=props[name];
  if(onPress)safe.onClick=onPress;
  if(onChangeText)safe.onInput=e=>onChangeText(e.target.value);
  return React.createElement(tag,safe,children);
};
const generic = new Proxy({__esModule:true, default:dom('div')}, {get:(target,key)=> key in target ? target[key] : dom('div')});
const fixture = {
 'react':React,'react/jsx-runtime':require('react/jsx-runtime'), 'zustand':require('zustand'),
 '@tanstack/react-query':{useQueryClient:()=>queryClient},
 'solito/navigation':{useParams:()=>({id:'7'}),useRouter:()=>router},
 'expo-router':{useLocalSearchParams:()=>({id:'7'}),useRouter:()=>router},
 'react-native':{View:dom('div'),Text:dom('span'),ScrollView:dom('div'),Pressable:dom('button'),TextInput:dom('input'),ActivityIndicator:()=>React.createElement('span',null,'Loading event'),Switch:()=>null,Platform:{OS:'ios'},StyleSheet:{create:o=>o}},
 '@gorhom/bottom-sheet':{__esModule:true,default:React.forwardRef(({children},ref)=>{React.useImperativeHandle(ref,()=>({snapToIndex:noop,close:noop}));return React.createElement('div',null,children)}),BottomSheetView:dom('div'),BottomSheetBackdrop:()=>null},
 '@dvnt/ui':{FormField:({label,children})=>React.createElement('label',null,label,children),useDirtyGuard:noop},
 '@dvnt/app/lib/stores/auth-store':{useAuthStore},
 '@dvnt/app/lib/stores/ui-store':{useUIStore:selector=>selector({showToast})},
 '@dvnt/app/lib/hooks/use-events':{useEvent:()=>({data:event,isLoading:false}),useUpdateEvent:()=>mutation,eventKeys:{all:['events'],detail:id=>['events',id]}},
 '@dvnt/app/lib/hooks/use-event-role':{useEventRole:()=>({role:state.role,hasResolved:state.resolved,isPending:state.pending,isPaused:state.paused,isError:state.error,errorStatus:state.errorStatus,refetch:async()=>{}})},
 '@dvnt/app/lib/hooks':{useColorScheme:()=>({colors}),useMediaPicker:()=>mediaPicker},
 '@dvnt/app/lib/hooks/use-media-upload':{useMediaUpload:()=>({uploadMultiple:async files=>{state.uploads?.push(...files.map(f=>f.uri));disturbSession();if(state.revokeOnUpload){state.role=null;state.eventFailure=true;}return files.map(()=>({success:true,url:'https://media.test/new-flyer.jpg'}));},isUploading:false,progress:0})},
 '@dvnt/app/lib/media/use-event-flyer-preparation.web':{useEventFlyerPreparation:()=>({isBusy:()=>false,isPreparing:false,cancel:noop})},
 '@dvnt/app/lib/auth/session-lifecycle':{getSessionLifecycle:()=>({ready:true,epoch:state.epoch??1}),subscribeSessionLifecycle:()=>noop},
 '@dvnt/app/lib/auth/identity':{getAuthIdFromStore:()=>auth.user.authId},
 '@dvnt/app/lib/auth-client':{getAuthToken:async()=> 'fixture-token'},
 '@dvnt/app/lib/api/events':{eventsApi:{getEventById:async()=>event}},
 '@dvnt/app/lib/api/ticket-types':{ticketTypesApi,TICKET_TYPE_CATEGORIES:[],TIER_TYPE_OPTIONS:[],TIER_VISIBILITY_OPTIONS:[]},
 '@dvnt/app/features/events/create/addons-editor.web':{AddonsEditor:()=>React.createElement('div',{'data-addon-editor':'true'})},
 '@dvnt/app/lib/api/addons':{ADDON_TYPE_OPTIONS:[{value:'merch',label:'Merch'}],ADDON_BINDING_OPTIONS:[{value:'standalone',label:'Standalone'}],ADDON_STATUS_OPTIONS:[{value:'on_sale',label:'On sale'}],VARIANT_ADDON_TYPES:new Set(['merch']),REDEEMABLE_DEFAULTS:{merch:true},addonsApi:{getByEvent:async()=>{if(state.addonLoadFailure)throw Error('catalog unavailable');return state.addonRows||[];},update:async(...args)=>{state.addonWrites?.push(args);if(state.addonFailure)throw Error('No row updated');return true;},syncVariants:async(id,rows,onPersisted)=>{state.variantCalls?.push({id,rows});if(state.variantFailure){onPersisted?.(0,{id:'persisted-variant',option_values:rows[0].optionValues});throw Error('second variant failed');}return true;},create:async params=>{state.addonCreates?.push(params);if(state.addonCreateFailure)throw Object.assign(Error('variant create failed'),{addonId:'created-addon'});return {id:'created-addon'};},remove:async()=>true}},
 '@dvnt/app/lib/server-upload':{uploadToServer:async url=>{state.uploads?.push(url);disturbSession();if(state.revokeOnUpload){state.role=null;state.eventFailure=true;}return {success:true,url:'https://media.test/new-flyer.jpg'};}},
 '@dvnt/app/lib/media/persist-local-selection':{isRemoteMediaUri:url=>/^https?:/.test(url),persistLocalMediaSelection:async url=>url},
 '@dvnt/app/lib/api/organizer':{organizerApi:{getStatus:async()=>{state.bankChecks++;return {connected:false}}}},
 '@dvnt/app/components/error-boundary':{ErrorBoundary:dom('div')},
 './ui/followup-settings.web':{EventFollowupSettings:()=>React.createElement('span',null,'Followup controls')},
 '@dvnt/app/features/events/ui/followup-settings.native':{EventFollowupSettings:()=>React.createElement('span',null,'Followup controls')},
};
const cache = new Map();
function load(relative) {
 const file=path.resolve(ROOT,relative);
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const localRequire = name => {
  if(fixture[name])return fixture[name];
  if(name==='../api/addons')return fixture['@dvnt/app/lib/api/addons'];
  if(name==='@dvnt/app/features/events/create/addons-editor.native')return load('packages/app/features/events/create/addons-editor.native.tsx');
  if(name.startsWith('@dvnt/app/lib/events/') || name==='@dvnt/app/lib/stores/event-edit-store' || name==='@dvnt/app/features/events/create/addon-form' || name==='@dvnt/app/features/events/create/event-form' || name==='@dvnt/app/lib/tickets/pricing')return load('packages/app/'+name.slice(10)+'.ts');
  if(name.startsWith('.')){
   const stem=path.resolve(path.dirname(file),name);
   if(!/features\/events\/event-edit|features\/routes.*edit/.test(file)){
    for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix)&&fs.statSync(stem+suffix).isFile())return load(stem+suffix);
   }
  }
  return generic;
 };
 vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,console,URL,Date,Set,Map,Promise,AbortController,requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);if(ms>=1000)t.unref();return t;},clearTimeout},{filename:file});
 return module.exports;
}
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));const window=new Window();
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const web=load('packages/app/features/events/event-edit.web.tsx').EventEditScreen;
 const native=load('packages/app/features/routes/screens/(protected)/events/[id]/edit.tsx').default;
 const sheet=load('packages/app/features/events/ui/event-action-sheet.tsx').EventActionSheet;
 const store=load('packages/app/lib/stores/event-edit-store.ts').useEventEditStore;
 const {canEditEvent}=load('packages/app/lib/events/event-role.ts');
 const flush=async fn=>React.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,0));});
 let count=0;
 for(const [platform,Component] of [['web',web],['native',native]]){
  for(const role of ['owner','admin','editor','scanner',null]){
   state.role=role;state.resolved=true;state.pending=false;state.paused=false;state.error=false;state.authenticated=true;state.saves=[];state.bankChecks=0;
   store.getState().reset();
   const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
   try {
    await flush(()=>root.render(React.createElement(Component)));
    const text=node.textContent;
    assert.equal(text.includes('Edit Event'),canEditEvent(role),`${platform} ${role}: ${text.slice(0,150)}`);
    if(canEditEvent(role)){
     assert.equal(text.includes('Followup controls'),role==='owner'||role==='admin','followup settings require admin');
     assert.ok(text.includes('Flyer'),`${platform} ${role} can change flyer`);
     assert.ok(text.includes('Ticket'),`${platform} ${role} can change tickets`);
    }
    // Resolved permission disappearing must hide the mounted form immediately.
    state.role=null;await flush(()=>root.render(React.createElement(Component)));
    assert.equal(node.textContent.includes('Edit Event'),false,`${platform}: revoked role hides editor`);
    count++;
   }finally{await flush(()=>root.unmount());node.remove();}
  }
  for(const mode of ['pending','offline','error','signed-out']){
   state.role='editor';state.resolved=false;state.pending=mode==='pending'||mode==='offline';state.paused=mode==='offline';state.error=mode==='error';state.authenticated=mode!=='signed-out';
   const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
   try{await flush(()=>root.render(React.createElement(Component)));assert.equal(node.textContent.includes('Edit Event'),false,`${platform} ${mode} fails closed`);if(mode==='offline'||mode==='error')assert.match(node.textContent,/connection.*retry/);count++;}
   finally{await flush(()=>root.unmount());node.remove();}
  }
 }
 // Editing a paid event must use its owner's payout identity, never the
 // co-host's bank account. Exercise the real native save callback.
 for(const role of ['admin','editor','owner']){
  Object.assign(state,{role,resolved:true,pending:false,paused:false,error:false,authenticated:true,saves:[],bankChecks:0,navigations:[]});
  store.getState().reset();
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(native)));
   const title=[...node.querySelectorAll('input')].find(i=>i.value==='Co-host event');
   assert.ok(title,'native title is editable');
   await flush(()=>{title.value='Updated by co-host';title.dispatchEvent(new window.Event('input',{bubbles:true}));});
   const save=node.querySelector('button');assert.equal(save.disabled,false,'changed form is saveable');
   await flush(()=>save.click());
   assert.equal(state.bankChecks,role==='owner'?1:0,`${role} payout preflight`);
   assert.equal(state.saves.length,role==='owner'?0:1,`${role} saves without personal payout account`);
   if(role!=='owner')assert.equal(state.saves[0].updates.title,'Updated by co-host');
   count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 // Exercise real save callbacks and serialized payloads; only transport/platform
 // adapters are mocked. Revocation simulates the authoritative server refusal
 // after upload; it is not a full JWT/RLS integration. Native add-ons follow below.
 for(const [platform,Component] of [['web',web],['native',native]]){
  for(const mode of ['success','admin-success','event-refused','revoked-during-upload','tier-refused',...(platform==='web'?['addon-refused']:[])]){
   Object.assign(state,{role:mode==='admin-success'?'admin':'editor',resolved:true,pending:false,paused:false,error:false,authenticated:true,saves:[],bankChecks:0,navigations:[],toasts:[],uploads:[],tierWrites:[],addonWrites:[],eventFailure:mode==='event-refused',revokeOnUpload:mode==='revoked-during-upload',tierFailure:mode==='tier-refused',addonFailure:mode==='addon-refused'});
   store.getState().reset();
   const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
   try{
    await flush(()=>root.render(React.createElement(Component)));
    if(platform==='web'){
     await flush(()=>{store.getState().setFlyerImage('blob:new-flyer');store.getState().updateTier(0,{priceDollars:'37.25'});store.getState().addAddon();store.getState().updateAddon(0,{dbId:'addon-7',name:'T-shirt',priceDollars:'12.50'});});
    }else{
     const flyer=[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add Flyer'));assert.ok(flyer,'native flyer picker');await flush(()=>flyer.click());
     const price=[...node.querySelectorAll('input')].find(i=>i.value==='20'&&i.placeholder==='0');assert.ok(price,'native tier price input');
     await flush(()=>{price.value='37.25';price.dispatchEvent(new window.Event('input',{bubbles:true}));});
    }
    const save=platform==='web'?[...node.querySelectorAll('button')].find(b=>b.textContent==='Done'):node.querySelector('button');
    assert.ok(save);await flush(()=>save.click());
    assert.equal(state.uploads.length,1,platform+'/'+mode+' uploads flyer once');
    assert.equal(state.saves.length,1);
    assert.equal(state.saves[0].updates.flyerImageUrl,'https://media.test/new-flyer.jpg');
    if((mode==='event-refused'||mode==='revoked-during-upload'))assert.equal(state.tierWrites.length,0,'refused event must not continue catalog writes');
    else {
     assert.equal(state.tierWrites.length,1);
     assert.equal(state.tierWrites[0][1].price_cents,3725,'changed tier dollars serialize to cents');
     if(platform==='web'){assert.equal(state.addonWrites.length,1);assert.equal(state.addonWrites[0][1].price_cents,1250);}
    }
    if(mode==='success'||mode==='admin-success'){assert.ok(state.toasts.some(t=>t[0]==='success'));assert.ok(state.navigations.length);}
    else {assert.ok(state.toasts.some(t=>t[0]==='error'||t[0]==='warning'));assert.equal(state.toasts.some(t=>t[0]==='success'),false,'failed or partial writes never claim complete success');assert.equal(state.navigations.length,0,'failed save keeps editor open');if(mode!=='revoked-during-upload'){if(platform==='web')assert.equal(store.getState().ticketTiers[0].priceDollars,'37.25','retry retains changed tier');else assert.ok([...node.querySelectorAll('input')].some(i=>i.value==='37.25'),'native retry retains changed tier');}}
    count++;
   }finally{await flush(()=>root.unmount());node.remove();Object.assign(state,{eventFailure:false,tierFailure:false,addonFailure:false,revokeOnUpload:false});}
  }
 }
 // Partial multi-row writes must preserve successful IDs for an explicit retry.
 const resetInteractions=()=>{auth.user={id:'cohost',authId:'cohost'};Object.assign(state,{epoch:1,switchAccountOnUpload:false,returnToAccount:false,role:'editor',resolved:true,pending:false,paused:false,error:false,authenticated:true,saves:[],navigations:[],toasts:[],tierWrites:[],addonWrites:[],tierCreates:[],addonCreates:[],variantCalls:[],addonRows:[],tierFailure:false,addonFailure:false,eventFailure:false,revokeOnUpload:false,tierLoadFailure:false,addonLoadFailure:false,addonCreateFailure:false,variantFailure:false,deferTierCreate:false});store.getState().reset();};
 for(const [platform,Component] of [['web',web],['native',native]])for(const returns of [false,true]){
  resetInteractions();state.switchAccountOnUpload=true;state.returnToAccount=returns;
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(Component)));
   if(platform==='web')await flush(()=>store.getState().setFlyerImage('blob:account-switch'));
   else {const pick=[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add Flyer'));assert.ok(pick);await flush(()=>pick.click());}
   const save=platform==='web'?[...node.querySelectorAll('button')].find(b=>b.textContent==='Done'):node.querySelector('button');
   await flush(()=>save.click());
   assert.equal(state.saves.length,0,`${platform} account switch${returns?' and return':''} blocks stale event save`);
   assert.equal(state.tierWrites.length,0);assert.equal(state.addonWrites.length,0);assert.equal(state.navigations.length,0);
   assert.equal(state.toasts.some(t=>t[0]==='success'),false);count++;
  }finally{await flush(()=>root.unmount());node.remove();resetInteractions();}
 }
 for(const [platform,Component] of [['web',web],['native',native]]){
  resetInteractions();
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(Component)));
   if(platform==='web')await flush(()=>store.getState().addTier());
   else await flush(()=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add Tier')).click());
   const save=()=>platform==='web'?[...node.querySelectorAll('button')].find(b=>b.textContent==='Done'):node.querySelector('button');
   state.tierFailure=true;state.deferTierCreate=true;
   await flush(()=>{save().click();save().click();});
   assert.equal(state.tierCreates.length,1,'repeated Done must not duplicate in-flight creation');
   assert.equal(state.toasts.some(t=>t[1]==='Partial save'),false,'wait for successful sibling before enabling retry');
   assert.equal(state.navigations.length,0);
   await flush(()=>state.finishTierCreate());
   assert.equal(state.toasts.some(t=>t[1]==='Partial save'),true);
   if(platform==='web')assert.equal(store.getState().ticketTiers[1].id,'new');
   state.tierFailure=false;state.deferTierCreate=false;state.toasts=[];
   await flush(()=>save().click());
   assert.equal(state.tierCreates.length,1,'retry updates confirmed new tier instead of creating it twice');
   assert.ok(state.tierWrites.some(([id])=>id==='new'));
   assert.ok(state.toasts.some(t=>t[0]==='success'));
   count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 for(const mode of ['addon-create','variant-update']){
  resetInteractions();
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(web)));
   await flush(()=>{store.getState().addAddon();store.getState().updateAddon(0,{name:'Shirt',priceDollars:'12',...(mode==='variant-update'?{dbId:'existing-addon',variants:[{size:'M',color:'',priceDollars:'',quantity:''},{size:'L',color:'',priceDollars:'',quantity:''}]}:{})});});
   state.addonCreateFailure=mode==='addon-create';state.variantFailure=mode==='variant-update';
   const save=()=>[...node.querySelectorAll('button')].find(b=>b.textContent==='Done');
   await flush(()=>save().click());
   assert.equal(state.navigations.length,0);assert.ok(state.toasts.some(t=>t[1]==='Partial save'));
   if(mode==='addon-create')assert.equal(store.getState().addons[0].dbId,'created-addon');
   else assert.equal(store.getState().addons[0].variants[0].dbId,'persisted-variant');
   state.addonCreateFailure=false;state.variantFailure=false;state.toasts=[];
   await flush(()=>save().click());
   if(mode==='addon-create'){assert.equal(state.addonCreates.length,1);assert.ok(state.addonWrites.some(([id])=>id==='created-addon'));}
   else {assert.equal(state.variantCalls.length,2);assert.equal(state.variantCalls[1].rows[0].id,'persisted-variant');}
   assert.ok(state.toasts.some(t=>t[0]==='success'));count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 for(const mode of ['tiers','addons']){
  resetInteractions();state.tierLoadFailure=mode==='tiers';state.addonLoadFailure=mode==='addons';
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(web)));
   const done=[...node.querySelectorAll('button')].find(b=>b.textContent==='Done');assert.equal(done.disabled,true,'failed catalog load blocks save');
   if(mode==='tiers'){const add=[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add Tier'));assert.ok(add);assert.equal(add.disabled,true,'failed tier load blocks duplicate reconstruction');}
   if(mode==='addons')assert.equal(node.querySelector('[data-addon-editor]'),null,'failed add-on load hides editing controls');
   await flush(()=>done.click());assert.equal(state.saves.length,0);count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 // Native parity: mount the real AddonsEditorNative, edit its inputs, and
 // exercise the screen's shared catalog save/retry callbacks.
 for(const mode of ['success','update-refused','partial-create','partial-variant']){
  resetInteractions();
  if(mode!=='partial-create')state.addonRows=[{id:'native-addon',name:'Native shirt',addon_type:'merch',binding_mode:'standalone',price_cents:900,status:'on_sale',is_redeemable:false,ticket_addon_variants:[]}];
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(native)));
   const input=placeholder=>[...node.querySelectorAll('input')].find(i=>i.placeholder===placeholder);
   const type=async(field,value)=>{assert.ok(field,'native addon input exists');await flush(()=>{field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));});};
   if(mode==='partial-create'){
    const add=[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add an Add-on'));assert.ok(add);await flush(()=>add.click());
    await type(input('Add-on name (e.g. Coat check, Event tee)'),'New shirt');
   }
   await type(input('0.00'),'16.25');
   if(mode==='partial-variant'){
    for(const size of ['M','L']){
     const add=[...node.querySelectorAll('button')].find(b=>b.textContent.includes('Add size / color'));assert.ok(add);await flush(()=>add.click());
     const sizes=[...node.querySelectorAll('input')].filter(i=>i.placeholder==='Size');await type(sizes.at(-1),size);
    }
   }
   state.addonFailure=mode==='update-refused';state.addonCreateFailure=mode==='partial-create';state.variantFailure=mode==='partial-variant';
   await flush(()=>node.querySelector('button').click());
   if(mode!=='partial-create')assert.equal(state.addonWrites[0][1].price_cents,1625);
   if(mode==='success')assert.ok(state.toasts.some(t=>t[0]==='success'));
   else{
    assert.equal(state.navigations.length,0);assert.ok(state.toasts.some(t=>t[1]==='Partial save'));assert.equal(state.toasts.some(t=>t[0]==='success'),false);
    assert.equal(input('0.00').value,'16.25','native addon price survives failed save');
    state.addonFailure=false;state.addonCreateFailure=false;state.variantFailure=false;state.toasts=[];
    await flush(()=>node.querySelector('button').click());
    if(mode==='partial-create'){assert.equal(state.addonCreates.length,1);assert.ok(state.addonWrites.some(([id])=>id==='created-addon'));}
    if(mode==='partial-variant'){assert.equal(state.variantCalls.length,2);assert.equal(state.variantCalls[1].rows[0].id,'persisted-variant');}
    assert.ok(state.toasts.some(t=>t[0]==='success'));
   }
   count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 resetInteractions();state.tierLoadFailure=true;
 {
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{await flush(()=>root.render(React.createElement(native)));assert.equal(node.textContent.includes('Edit Event'),false,'native failed tier hydration never exposes an empty writable catalog');assert.equal([...node.querySelectorAll('button')].some(b=>b.textContent.includes('Add Tier')),false);assert.equal(state.saves.length,0);assert.ok(state.toasts.some(t=>t[0]==='error'));count++;}
  finally{await flush(()=>root.unmount());node.remove();}
 }
 resetInteractions();
 for(const role of ['owner','admin','editor','scanner',null]){
  const node=document.createElement('div');document.body.append(node);const root=createRoot(node);
  try{
   await flush(()=>root.render(React.createElement(sheet,{visible:true,isHost:role==='owner',canEdit:canEditEvent(role),isLiked:false,onClose:noop,onEdit:noop,onDelete:noop,onShare:noop,onToggleLike:noop,onAddToCalendar:noop,onPromote:noop,onStaff:noop,onCancelEvent:noop})));
   assert.equal(node.textContent.includes('Edit Event'),canEditEvent(role));
   for(const text of ['Delete Event','Cancel Event','Promote to Spotlight'])assert.equal(node.textContent.includes(text),role==='owner',`${role}/${text}`);
   count++;
  }finally{await flush(()=>root.unmount());node.remove();}
 }
 console.log(`Passed ${count} mounted web/native editor and action-sheet cases.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
