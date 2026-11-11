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
const state = { role: 'editor', resolved: true, pending: false, paused: false, error: false, authenticated: true, saves: [], navigations: [], bankChecks: 0 };
const event = {id:'7', title:'Co-host event', description:'Details', fullDate:'2026-12-11T22:00:00Z', eventTz:'UTC', host:{id:'different-owner-id'}, price:20, ticketingEnabled:true, visibility:'public'};
const auth = {user:{id:'cohost', authId:'cohost'}, isAuthenticated:true};
const useAuthStore = selector => selector({...auth, isAuthenticated:state.authenticated});
useAuthStore.subscribe = () => noop;
useAuthStore.getState = () => auth;
const router = {push:p=>state.navigations.push(p), replace:p=>state.navigations.push(p), back:()=>state.navigations.push('back')};
const mutation = {isPending:false, mutateAsync:async value=>state.saves.push(value)};
const queryClient = {invalidateQueries:async()=>{},setQueryData:noop};
const tier = {id:'tier-7',name:'General Admission',category:'admission',price_cents:2000,quantity_total:100,max_per_user:4,is_active:true};
const ticketTypesApi = {getByEvent:async()=>[tier],create:async()=>({id:'new'}),update:async()=>true,deactivate:async()=>true};
const mediaPicker = {pickFromLibrary:async()=>[],requestPermissions:noop};
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
 '@dvnt/app/lib/stores/ui-store':{useUIStore:selector=>selector({showToast:noop})},
 '@dvnt/app/lib/hooks/use-events':{useEvent:()=>({data:event,isLoading:false}),useUpdateEvent:()=>mutation,eventKeys:{all:['events'],detail:id=>['events',id]}},
 '@dvnt/app/lib/hooks/use-event-role':{useEventRole:()=>({role:state.role,hasResolved:state.resolved,isPending:state.pending,isPaused:state.paused,isError:state.error,errorStatus:state.errorStatus,refetch:async()=>{}})},
 '@dvnt/app/lib/hooks':{useColorScheme:()=>({colors}),useMediaPicker:()=>mediaPicker},
 '@dvnt/app/lib/hooks/use-media-upload':{useMediaUpload:()=>({uploadMultiple:async()=>[],isUploading:false,progress:0})},
 '@dvnt/app/lib/media/use-event-flyer-preparation.web':{useEventFlyerPreparation:()=>({isBusy:()=>false,isPreparing:false,cancel:noop})},
 '@dvnt/app/lib/auth/session-lifecycle':{getSessionLifecycle:()=>({ready:true,epoch:1}),subscribeSessionLifecycle:()=>noop},
 '@dvnt/app/lib/auth/identity':{getAuthIdFromStore:()=> 'cohost'},
 '@dvnt/app/lib/auth-client':{getAuthToken:async()=> 'fixture-token'},
 '@dvnt/app/lib/api/events':{eventsApi:{getEventById:async()=>event}},
 '@dvnt/app/lib/api/ticket-types':{ticketTypesApi,TICKET_TYPE_CATEGORIES:[],TIER_TYPE_OPTIONS:[],TIER_VISIBILITY_OPTIONS:[]},
 '@dvnt/app/lib/api/addons':{addonsApi:{getByEvent:async()=>[]}},
 '@dvnt/app/lib/api/organizer':{organizerApi:{getStatus:async()=>{state.bankChecks++;return {connected:false}}}},
 '@dvnt/app/components/error-boundary':{ErrorBoundary:dom('div')},
};
const cache = new Map();
function load(relative) {
 const file=path.resolve(ROOT,relative);
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const localRequire = name => {
  if(fixture[name])return fixture[name];
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
