#!/usr/bin/env node
// Real web create/edit forms + real stores and buyer cards, with offline synthetic
// auth/network/native-host boundaries. No published event, payment or live data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean).map(p => path.resolve(p));
const resolve = name => require.resolve(name, { paths: [root, ...nodePaths] });
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const options = file => [...read(file).matchAll(/export const [A-Z_]+[^=]*= \[[\s\S]*?\n\];/g)].map(m => m[0]).join('\n');
const mocks = {
  '@dvnt/supabase': `export const supabase={};`,
  'fixture': `export const state={creates:[],updates:[],events:[],routes:[],toasts:[]};export const event={id:'fixture-event',hostId:'fixture-owner',title:'Fixture edit event',startDate:'2099-12-31T20:00:00Z',event_tz:'UTC',location:'Test venue',category:'party',price:0,visibility:'public',ticketingEnabled:true};export const tier={id:'fixture-service-tier',name:'Coat check',category:'service',price_cents:1000,quantity_total:100,quantity_sold:0,max_per_user:10,tier_type:'ga',tier:'ga',is_active:true};`,
  'solito/navigation': `import {state} from 'fixture'; export const usePathname=()=>'/feed/events/create';export const useParams=()=>({id:'fixture-event'});export const useRouter=()=>({push:p=>state.routes.push(p),replace:p=>state.routes.push(p),back:()=>{}});`,
  '@dvnt/app/lib/stores/auth-store': `const state={user:{id:'fixture-owner',username:'member'},isAuthenticated:true,_hasHydrated:true};export const useAuthStore=selector=>selector(state);useAuthStore.getState=()=>state;useAuthStore.subscribe=()=>()=>{};`,
  '@dvnt/app/lib/stores/ui-store': `import {state} from 'fixture';export const useUIStore=selector=>selector({showToast:(...x)=>state.toasts.push(x)});`,
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
  '@dvnt/app/lib/hooks/use-events': `import {state,event} from 'fixture';export const useEvent=()=>({data:event,isLoading:false});export const useCreateEvent=()=>({isPending:false,mutateAsync:async x=>{state.events.push(x);return {id:'fixture-created-event'}}});export const useUpdateEvent=useCreateEvent;`,
  '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=> (_action,run)=>run();`,
  '@dvnt/app/lib/hooks/use-places-autocomplete': `export const usePlacesAutocomplete=()=>({predictions:[],isLoading:false,input:'Test venue',setInput:()=>{},setShowDropdown:()=>{},clear:()=>{},selectPrediction:()=>{}});`,
  '@dvnt/app/lib/hooks/use-event-media-preupload': `export const useEventMediaPreupload=()=>{};`,
  '@dvnt/app/lib/media/use-event-flyer-preparation.web': `export const useEventFlyerPreparation=()=>({isPreparing:false,isBusy:()=>false,prepare:async()=>null,cancel:()=>{}});`,
  '@dvnt/app/lib/api/ticket-types': `${options('packages/app/lib/api/ticket-types.ts')} import {state,tier} from 'fixture';export const ticketTypesApi={getByEvent:async()=>[{...tier}],create:async x=>{state.creates.push(x);return {id:'fixture-new-tier'}},update:async(id,x)=>{state.updates.push({id,...x});return x},deactivate:async()=>{}};`,
  '@dvnt/app/lib/api/addons': `${options('packages/app/lib/api/addons.ts')} ${read('packages/app/lib/api/addons.ts').match(/export const VARIANT_ADDON_TYPES[^;]+;/)[0]} ${read('packages/app/lib/api/addons.ts').match(/export const REDEEMABLE_DEFAULTS[^=]+= \{[\s\S]*?\n\};/)[0]} export const addonsApi={getByEvent:async()=>[]};`,
  '@dvnt/app/lib/api/organizer': `export const organizerApi={getStatus:async()=>({connected:true,charges_enabled:true,payouts_enabled:true})};`,
  '@dvnt/app/features/sneaky-lynk/api/supabase': `export const sneakyLynkApi={};`,
  '@dvnt/app/lib/server-upload': `export const uploadToServer=()=>{throw Error('upload forbidden')};`,
  '@dvnt/app/lib/api/privileged': `export const inviteEventGuests=()=>{};`,
  '@dvnt/app/lib/api/users': `export const usersApi={searchUsers:async()=>[]};`,
  '@dvnt/app/lib/api/events': `export const eventsApi={};`,
  '@dvnt/app/lib/api/event-drafts': `export const eventDraftsApi={saveCurrent:async()=>({revision:1})};`,
  '@dvnt/app/lib/auth-client': `export const getAuthToken=async()=> 'fixture-token';`,
  '@dvnt/app/lib/auth/identity': `export const getAuthIdFromStore=()=> 'fixture-owner';export const requireBetterAuthToken=async()=> 'fixture-token';`,
  '@dvnt/app/lib/auth/session-lifecycle': `export const getSessionLifecycle=()=>({ready:true,epoch:1});export const subscribeSessionLifecycle=()=>()=>{};`,
  '@dvnt/app/lib/stores/event-guest-store': `import {create} from 'zustand';export const useEventGuestStore=create(()=>({guests:[],results:[],search:'',loading:false,load:async()=>{},reset:()=>{}}));`,
  '@dvnt/ui': `export const FormField=({children})=><div>{children}</div>;export const useDirtyGuard=()=>{};export const VenueSearchInput=()=>null;`,
  '@dvnt/ui/sticky-save-bar-web': `export const StickySaveBar=({visible,onSave,onCancel})=>visible?<div><button onClick={onSave}>Save changes</button><button onClick={onCancel}>Discard</button></div>:null;`,
  '@dvnt/app/components/use-visual-viewport-bottom.web': `export const useVisualViewportBottom=()=>{};`,
  '@dvnt/app/components/ui/html': `export const Main=props=><main {...props}/>;`,
  '@dvnt/app/lib/theme': `export const color={hairline:'#333',surface:'#111',signal:'#f00',magenta:'#f0f'};`,
  '@dvnt/app/features/events/ui/event-zone-picker.web': `export const EventZonePickerWeb=()=>null;`,
  '@dvnt/app/features/events/ui/event-publication-picker.web': `export const EventPublicationFieldWeb=()=>null;`,
  '@dvnt/app/components/event/event-attendance-field.web': `export const EventAttendanceField=()=>null;`,
  'react-native': `export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const Pressable=({children,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{children}</button>;export const StyleSheet={create:x=>x,hairlineWidth:1};`,
  'react-native-reanimated': `import {Pressable} from 'react-native';export default {createAnimatedComponent:()=>Pressable};export const useAnimatedStyle=f=>f();export const useSharedValue=v=>({value:v});export const withTiming=v=>v;export const withSequence=(...v)=>v.at(-1);export const Easing={out:x=>x,cubic:0};`,
  'expo-haptics': `export const impactAsync=()=>{};export const ImpactFeedbackStyle={Medium:'medium'};`,
  'lucide-react-native': `export const Check=()=>null;`,
};
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://service-fixture.invalid'});
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dvnt-service-category-'));let renderer,f;
 try {
  await require(resolve('esbuild')).build({stdin:{resolveDir:root,loader:'tsx',contents:`export {default as React,act} from 'react';export {createRoot} from 'react-dom/client';export {CreateEventScreen as Create} from './packages/app/features/events/event-create.web';export {EventEditScreen as Edit} from './packages/app/features/events/event-edit.web';export {useCreateEventStore as createStore} from './packages/app/lib/stores/create-event-store';export {useEventEditStore as editStore} from './packages/app/lib/stores/event-edit-store';export {TicketTierCard as WebCard} from './packages/app/components/event/TicketTierCard.web';export {TicketTierCard as NativeCard} from './packages/app/features/events/ui/TicketTierCard';export {state} from 'fixture';`},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'app.cjs'),nodePaths,alias:Object.fromEntries(['react','react-dom','zustand'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},plugins:[{name:'offline-service-ui',setup(b){
   b.onResolve({filter:/.*/},a=>{let key=a.path;if(a.path.startsWith('.'))key='@dvnt/app/'+path.relative(path.join(root,'packages/app'),path.resolve(a.resolveDir,a.path)).replace(/\\/g,'/');if(Object.hasOwn(mocks,key))return{path:key,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const stem=path.join(root,'packages/app',a.path.slice(10));for(const suffix of ['.ts','.tsx','/index.ts'])if(fs.existsSync(stem+suffix))return{path:stem+suffix};}});
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));
  }}]});
  f=require(path.join(dir,'app.cjs'));const flush=async run=>f.act(async()=>{if(run)await run();await new Promise(r=>setTimeout(r,30));});
  const host=document.createElement('div');document.body.append(host);renderer=f.createRoot(host);
  const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const click=async text=>{const b=button(text);assert.ok(b,`button ${text} exists`);assert.equal(b.disabled,false);await flush(()=>b.click());};
  const assertService=()=>{assert.ok(button('Service'));assert.equal(button('Service').getAttribute('aria-pressed'),'true');assert.equal(button('GA'),undefined);assert.equal(button('ga'),undefined);assert.equal(button('VIP'),undefined);assert.match(host.textContent,/Does not include event admission/);};
  await flush(()=>renderer.render(f.React.createElement(f.Edit)));await flush();
  assertService();assert.equal(f.editStore.getState().ticketTiers[0].tierType,'ga');
  // Changing a former free-admission style into a service must not lock price.
  await flush(()=>f.editStore.getState().updateTier(0,{tier:'free'}));
  assert.equal(host.querySelector('input[inputmode=decimal]').disabled,false);
  await flush(()=>f.editStore.getState().updateTier(0,{tier:'ga',priceDollars:'10'}));
  await click('Add-on');assert.equal(button('GA'),undefined);assert.equal(button('Add-on').getAttribute('aria-pressed'),'true');
  await click('Service');assertService();
  await click('Admission');assert.ok(button('GA'));assert.ok(button('ga'));
  await click('Service');assertService();await click('Save changes');await flush();
  assert.equal(f.state.updates.length,1);assert.equal(f.state.updates[0].category,'service');assert.equal(f.state.updates[0].price_cents,1000);assert.equal(f.state.updates[0].max_per_user,10);assert.equal(f.state.updates[0].tier_type,'ga');
  await flush(()=>renderer.render(null));
  await flush(()=>{
   f.createStore.getState().resetDraft();f.createStore.setState({title:'Fixture service event',eventType:'party',eventDate:'2099-12-31T20:00:00',eventTz:'UTC',isOnline:true,ticketingEnabled:true,agreementAccepted:true,ticketTiers:[{id:'fixture-draft-tier',name:'Coat check',category:'admission',priceCents:1000,quantity:100,maxPerUser:10,description:'',saleStart:'',saleEnd:'',tierType:'ga',visibility:'public',unlockCode:'',priceSchedule:[],subAllocations:[]}]});renderer.render(f.React.createElement(f.Create));
  });await flush();
  assert.ok(button('GA'));await click('Service');assertService();assert.equal(f.createStore.getState().ticketTiers[0].category,'service');
  // The production publish handler must preserve category (previously omitted).
  await click('Publish');await flush();assert.equal(f.state.creates.length,1,JSON.stringify(f.state.toasts));assert.equal(f.state.creates[0].category,'service');assert.equal(f.state.creates[0].name,'Coat check');assert.equal(f.state.creates[0].maxPerUser,10);
  for(const Card of [f.WebCard,f.NativeCard])for(const category of ['service','product','admission']){
   const tier={id:'fixture-tier',name:'Fixture item',tier:'ga',category,price:10,perks:[],remaining:5,isSoldOut:false,glowColor:'#3FDCFF'};
   await flush(()=>renderer.render(f.React.createElement(Card,{tier,isSelected:false,onSelect:()=>{}})));
   assert.ok(host.textContent.includes(category==='service'?'SERVICE':category==='product'?'ADD-ON':'GA'));
   if(category!=='admission')assert.equal(host.textContent.includes('GA'),false);
  }
  await flush(()=>renderer.unmount());console.log('PASS: real web service edit/create round-trip, admission toggles, and web/native buyer category cards');
 } finally { if(renderer&&f)await f.act(()=>renderer.unmount());await window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true}); }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
