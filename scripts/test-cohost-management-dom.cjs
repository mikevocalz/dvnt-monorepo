#!/usr/bin/env node
/** Mount the actual web/native management screens with an offline complete
 * roster. The shared metric helper and UI stores are real; API/auth/navigation
 * and RN host components are fixtures. Pagination itself has API tests. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const deps=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);
const resolve=n=>require.resolve(n,{paths:[ROOT,...deps]});
const {build}=require(resolve('esbuild'));
const fixtures={
 'count-fixture':`import {create} from 'zustand';export const useRoute=create(()=>({id:'17'}));export const state={rows:[],calls:[],toasts:[],fail:false,defer:false,releases:[]};export const router={push(){},back(){}};export const offline={hasOfflineData:()=>false,lastDownloaded:{},pendingScans:[]};`,
 'solito/navigation':`import {router,useRoute} from 'count-fixture';export const useParams=()=>useRoute();export const useRouter=()=>router;`,
 'expo-router':`import {router,useRoute} from 'count-fixture';export const useLocalSearchParams=()=>useRoute();export const useRouter=()=>router;export const useFocusEffect=()=>{};`,
 '@dvnt/app/lib/api/tickets':`import {state} from 'count-fixture';export const tickets={getEventTickets:async id=>{state.calls.push(id);const rows=state.rows,fail=state.fail;if(state.defer)await new Promise(resolve=>state.releases.push(resolve));if(fail)throw Error('Synthetic later-page failure');return rows;}};export const ticketsApi={};`,
 '@dvnt/app/lib/hooks/use-event-role':`const refetch=async()=>({isSuccess:true,data:'owner'});export const useEventRole=()=>({role:'owner',hasResolved:true,isPending:false,isPaused:false,isError:false,refetch});`,
 '@dvnt/app/lib/stores/auth-store':`const auth={user:{id:'count-owner'},isAuthenticated:true};export const useAuthStore=Object.assign(selector=>selector(auth),{getState:()=>auth});`,
 '@dvnt/app/lib/api/organizer':`export const organizerApi={refundTicket:()=>{throw Error('No mutations in count test');}};`,
 '@dvnt/app/lib/api/event-drafts':`export const eventDraftsApi={duplicateEvent:()=>{throw Error('No mutations in count test');}};`,
 '@dvnt/app/lib/stores/ui-store':`import {state} from 'count-fixture';const ui={showToast:(...x)=>state.toasts.push(x)};export const useUIStore=selector=>selector(ui);`,
 '@dvnt/app/lib/stores/offline-checkin-store':`import {offline} from 'count-fixture';export const useOfflineCheckinStore=()=>offline;`,
 '@dvnt/app/lib/hooks':`export const useColorScheme=()=>({colors:{background:'#000',foreground:'#fff',mutedForeground:'#aaa',primary:'#0cf',border:'#333'}});`,
 '@dvnt/app/components/error-boundary':`export const ErrorBoundary=({children})=>children;`,
 '@dvnt/app/components/layout/detail-header':`export const DetailBackButton=()=>null;`,
 '@tanstack/react-virtual':`export const useVirtualizer=({count})=>({getTotalSize:()=>count*96,getVirtualItems:()=>Array.from({length:count},(_,index)=>({index,key:index,start:index*96})),measureElement:()=>{}});`,
 'react-native':`export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=({children,refreshControl})=><div>{refreshControl}{children}</div>;export const Pressable=({children,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{children}</button>;export const RefreshControl=({onRefresh})=><button onClick={onRefresh}>Refresh roster</button>;export const ActivityIndicator=()=> <span>Loading</span>;export const Alert={alert:()=>{throw Error('Unexpected dialog');}};`,
 'react-native-safe-area-context':`export const SafeAreaView=({children})=><div>{children}</div>;`,
};
const icons=['ArrowLeft','BarChart3','CheckCircle','Clock','CloudUpload','Megaphone','QrCode','Settings','Tag','Undo2','User','Users','WifiOff','XCircle','CopyPlus','Nfc'];
fixtures['lucide-react']=fixtures['lucide-react-native']=icons.map(n=>`export const ${n}=()=>null;`).join('\n');

fixtures['count-fixture']=`import {create} from 'zustand';export const useRoute=create(()=>({id:'17'}));export const state={role:'owner',freshRole:'owner',auth:true,viewer:'viewer',pending:false,error:false,paused:false,rows:[],calls:[],toasts:[],mutations:[],invalidations:[],staff:[],staffError:false,queryKeys:[]};export const router={push(){},back(){}};export const offline={hasOfflineData:()=>false,lastDownloaded:{},pendingScans:[]};`;
fixtures['@dvnt/app/lib/hooks/use-event-role']=`import {state} from 'count-fixture';const refetch=async()=>({isSuccess:!state.error,data:state.freshRole});export const useEventRole=()=>({role:state.role,hasResolved:!state.pending&&!state.error&&!state.paused,isPending:state.pending,isPaused:state.paused,isError:state.error,refetch});`;
fixtures['@dvnt/app/lib/stores/auth-store']=`import {state} from 'count-fixture';const getState=()=>({user:{id:state.viewer},isAuthenticated:state.auth});export const useAuthStore=Object.assign(selector=>selector(getState()),{getState});`;
fixtures['@dvnt/app/lib/api/tickets']=`import {state} from 'count-fixture';export const tickets={getEventTickets:async id=>{state.calls.push(id);return state.rows;}};export const ticketsApi={};`;
fixtures['@dvnt/app/lib/api/organizer']=`import {state} from 'count-fixture';export const organizerApi={refundTicket:async id=>{state.mutations.push(['refund',id]);return {};}};`;
fixtures['@dvnt/app/lib/api/event-drafts']=`import {state} from 'count-fixture';export const eventDraftsApi={duplicateEvent:async id=>{state.mutations.push(['duplicate',id]);}};`;
fixtures['@tanstack/react-query']=`import {state} from 'count-fixture';const refetch=async()=>{if(state.afterRefetch)state.afterRefetch();return {isSuccess:!state.staffError,fetchStatus:state.paused?'paused':'idle',data:{callerRole:state.freshRole,staff:state.staff,promoters:state.freshPromoters||state.promoters||[]}};};export const useQuery=options=>{state.queryKeys.push(options.queryKey);return {data:options.queryKey[0]==='event-analytics'?state.summary:options.queryKey[0]==='event-promoter-leaderboard'?[]:options.queryKey[0]==='promoter-library'?[]:{callerRole:state.role,staff:state.staff,promoters:state.promoters||[]},isSuccess:!state.staffError&&!state.pending,isError:state.staffError,isLoading:state.pending,isPending:state.pending,fetchStatus:state.paused?"paused":"idle",refetch};};export const useQueryClient=()=>({invalidateQueries:x=>state.invalidations.push(x)});export const useMutation=options=>({isPending:false,mutate:arg=>Promise.resolve().then(()=>options.mutationFn(arg)).then(result=>options.onSuccess?.(result,arg),options.onError)});`;
fixtures['@dvnt/app/lib/api/privileged']=`import {state} from 'count-fixture';export const getEventStaff=async()=>({callerRole:state.role,staff:state.staff});export const addCoOrganizer=async(...x)=>{state.mutations.push(['add',...x]);return {};};export const inviteCoOrganizer=addCoOrganizer;export const revokeCoOrganizer=async(...x)=>{state.mutations.push(['revoke',...x]);return {};};`;
fixtures['@dvnt/app/features/events/ui/user-picker.web']=`export const UserPicker=()=>null;`;
fixtures['./ui/user-picker.web']=`export const UserPicker=()=>null;`;
fixtures['./door-mode-tabs.web']=`export const DoorModeTabs=()=>null;`;
fixtures['@dvnt/app/lib/theme/tier-colors']=`export const tierAccent=()=> '#fff';`;
fixtures['sonner']=`import {state} from 'count-fixture';export const toast={success:(...x)=>state.toasts.push(x),error:(...x)=>state.toasts.push(x)};`;
fixtures['@dvnt/ui']=`export const Dialog=({open,children,footer})=>open?<div>{children}{footer}</div>:null;`;
fixtures['react-native']=`import {state} from 'count-fixture';export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=({children,refreshControl})=><div>{refreshControl}{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;export const TextInput=({value,onChangeText,placeholder})=><input value={value} onChange={e=>onChangeText(e.target.value)} placeholder={placeholder}/>;export const RefreshControl=({onRefresh})=><button onClick={onRefresh}>Refresh roster</button>;export const ActivityIndicator=()=> <span>Loading</span>;export const Alert={alert:(_title,_message,buttons)=>{state.confirm=buttons.find(b=>b.style==='destructive').onPress;}};export const StyleSheet={create:x=>x};export const Linking={openURL:async()=>{}};`;
fixtures['lucide-react']=fixtures['lucide-react-native']=[...icons,'UserPlus','Shield','ShieldCheck','ScanLine','X','Link2','MessageSquare','Pause','Pencil','Play','Share2','DollarSign','Ticket','CheckCircle2','TrendingUp','AlertCircle','Download'].map(n=>`export const ${n}=()=>null;`).join('\n');
fixtures['@dvnt/app/lib/api/promoters']=`import {state} from 'count-fixture';export const promoterShareLink=()=> 'https://fixture.invalid/promo';export const promotersApi={list:async()=>({callerRole:state.role,promoters:state.promoters}),library:async()=>[],add:async x=>{state.mutations.push(['promoter-add',x]);return {displayName:'Added',code:'ADDED'};},update:async x=>{state.mutations.push(['promoter-update',x]);return {};},remove:async id=>{state.mutations.push(['promoter-remove',id]);return {};}};`;
fixtures['@dvnt/app/lib/hooks/use-events']=`export const useEvent=()=>({data:{id:'17',title:'Fixture event'}});`;
fixtures['@dvnt/app/lib/stripe/fee-calculator']=`export const formatCents=x=>'$'+(x/100).toFixed(2);`;
fixtures['@dvnt/app/lib/deep-linking/share-link']=`export const shareUrls={event:()=> 'https://fixture.invalid/event'};`;
fixtures['@dvnt/app/lib/sharing']=`export const shareMessage=async()=>{};`;
fixtures['expo-clipboard']=`export const setStringAsync=async()=>{};`;
fixtures['@dvnt/app/components/ui/screen-skeleton']=`export const ScreenSkeleton=()=> <span>Loading analytics</span>;`;
fixtures['expo-sharing']=`import {state} from 'count-fixture';export const isAvailableAsync=async()=>true;export const shareAsync=async()=>state.mutations.push(['share']);`;
fixtures['expo-file-system/legacy']=`import {state} from 'count-fixture';export const cacheDirectory='fixture/';export const EncodingType={UTF8:'utf8'};export const writeAsStringAsync=async()=>state.mutations.push(['write']);`;
fixtures['@dvnt/app/lib/api/event-analytics']=`import {state} from 'count-fixture';export const resolveAttendanceBreakdown=()=>({rsvp:0,paid:0,total:0});export const attendeesToCsv=()=> 'fixture';export const eventAnalyticsApi={getSummary:async()=>state.summary,getAttendees:async()=>{state.mutations.push(['export']);state.afterAttendees?.();return {title:'Fixture',attendees:[{}]};}};`;
const entry=`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {state,useRoute} from 'count-fixture';import {EventOrganizerScreen as Web} from './packages/app/features/events/organizer.web';import Native from './packages/app/features/routes/screens/(protected)/events/[id]/organizer';import {EventStaffScreen as StaffWeb} from './packages/app/features/events/staff.web';import StaffNative from './packages/app/features/routes/screens/(protected)/events/[id]/staff';import {EventPromotersScreen as PromotersWeb} from './packages/app/features/events/promoters.web';import PromotersNative from './packages/app/features/routes/screens/(protected)/events/[id]/promoters';import {EventAnalyticsScreen as AnalyticsWeb} from './packages/app/features/events/analytics.web';import Analytics from './packages/app/features/routes/screens/(protected)/events/[id]/analytics';export {state,useRoute,act};export const mount=(node,platform,staff=false)=>{const root=createRoot(node);return {render:()=>root.render(staff==='analytics'?(platform==='web'?<AnalyticsWeb/>:<Analytics/>):staff==='promoters'?(platform==='web'?<PromotersWeb/>:<PromotersNative/>):staff?(platform==='web'?<StaffWeb/>:<StaffNative/>):(platform==='web'?<Web/>:<Native/>)),unmount:()=>root.unmount()};};`;
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://organizer-fixture.invalid'});
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'organizer-permissions-'));let count=0;
 try{
  await build({stdin:{contents:entry,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'test.cjs'),nodePaths:deps,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},
   alias:Object.fromEntries(['react','react-dom','zustand'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),
   plugins:[{name:'offline-counts',setup(b){b.onResolve({filter:/.*/},a=>{if(Object.hasOwn(fixtures,a.path))return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
  const f=require(path.join(dir,'test.cjs'));const flush=fn=>f.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,0));});

  URL.createObjectURL=()=>{f.state.mutations.push(['write']);return 'blob:fixture';};URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){f.state.mutations.push(['share']);};window.alert=()=>{};
  const reset=(role='owner')=>Object.assign(f.state,{role,freshRole:role,auth:true,viewer:'viewer',pending:false,error:false,paused:false,rows:[{id:'ticket',status:'active',user:{name:'Fixture holder'},holder_name:'Fixture holder',created_at:'2026-01-01',createdAt:'2026-01-01'}],calls:[],toasts:[],mutations:[],invalidations:[],staff:[],staffError:false,queryKeys:[],afterRefetch:null,afterAttendees:null,freshPromoters:null,summary:{title:'Private financial summary',revenue:{netCents:100,grossCents:100,stripeFeeCents:0},ticketStats:{total:0,checkedIn:0},tiers:[],promoCodes:[]}});
  const hasButton=(node,text)=>[...node.querySelectorAll('button')].some(b=>b.textContent.trim().replace(/^＋\s*/, '')===text);
  const button=(node,text)=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim().replace(/^＋\s*/, '')===text);
  for(const platform of ['web','native'])for(const role of ['owner','admin','editor','scanner',null]){
   reset(role);const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{await flush(()=>app.render());
    const canEdit=['owner','admin','editor'].includes(role),admin=['owner','admin'].includes(role);
    assert.equal(hasButton(node,'Promo Codes'),canEdit,platform+'/'+role+' promo');
    assert.equal(hasButton(node,'Analytics'),admin,platform+'/'+role+' analytics');
    assert.equal(hasButton(node,'Promoters'),admin,platform+'/'+role+' promoters');
    assert.equal(hasButton(node,'Duplicate Event'),role==='owner',platform+'/'+role+' duplicate');
    assert.equal(hasButton(node,'Refund ticket'),role==='owner',platform+'/'+role+' refund');
    assert.equal(hasButton(node,'Open scanner'),role==='scanner');
    assert.equal(f.state.calls.length>0,canEdit,'denied roles do not load dashboard roster');
    f.state.auth=false;await flush(()=>app.render());assert.ok(!node.textContent.includes('Fixture holder'));assert.equal(hasButton(node,'Promo Codes'),false);
    count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const flag of ['pending','error','paused']){
   reset();f.state[flag]=true;const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{await flush(()=>app.render());assert.equal(f.state.calls.length,0);assert.equal(hasButton(node,'Duplicate Event'),false);assert.equal(hasButton(node,'Retry'),flag!=='pending');count++;}
   finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native']){
   reset();const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{await flush(()=>app.render());f.state.freshRole='editor';await flush(()=>button(node,'Duplicate Event').click());assert.deepEqual(f.state.mutations,[],'fresh downgrade blocks duplication');
    window.confirm=()=>true;await flush(()=>button(node,'Refund ticket').click());if(platform==='native')await flush(()=>f.state.confirm());assert.deepEqual(f.state.mutations,[],'fresh downgrade blocks refund');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const role of ['owner','admin','editor','scanner',null]){
   reset(role);f.state.staff=[{authId:'pending-admin',inviteId:'pending-admin',role:'admin',accepted:false,displayName:'Pending cohost'}, {authId:'editor',inviteId:'editor',role:'editor',accepted:true,displayName:'Accepted editor'}];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,true);
   try{await flush(()=>app.render());
    const removals=[...node.querySelectorAll('button')].filter(b=>platform==='web'?b.getAttribute('aria-label')?.startsWith('Remove '):b.getAttribute('aria-label')?.startsWith('Remove '));
    assert.equal(removals.length,role==='owner'?2:role==='admin'?1:0,platform+'/'+role+' revoke targets');
    assert.ok(f.state.queryKeys.every(key=>key[2]==='viewer'),'staff queries scoped to viewer');
    f.state.auth=false;await flush(()=>app.render());assert.ok(!node.textContent.includes('Pending cohost'));count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const revoked of [false,true]){
   reset('admin');f.state.staff=[{authId:'editor',inviteId:'editor',role:'editor',accepted:true,displayName:'Accepted editor'}];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,true);
   try{await flush(()=>app.render());if(revoked)f.state.freshRole='editor';
    const remove=node.querySelector('[aria-label="Remove Accepted editor"]');assert.ok(remove);
    await flush(()=>remove.click());if(platform==='web')await flush(()=>button(node,'Remove').click());
    assert.equal(f.state.mutations.length,revoked?0:1,'fresh revoked staff manager cannot submit');
    if(!revoked)assert.ok(f.state.invalidations.some(x=>x.queryKey[0]==='event-role'),'staff changes invalidate cached roles');
    count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const flag of ['pending','staffError','paused']){
   reset('admin');f.state[flag]=true;const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,true);
   try{await flush(()=>app.render());assert.equal(hasButton(node,'Retry'),flag!=='pending');assert.equal(node.querySelector('[aria-label^="Remove "]'),null);count++;}
   finally{await flush(()=>app.unmount());node.remove();}
  }
  const promoter={id:'promoter',displayName:'Fixture promoter',code:'FIXTURE',status:'active',customerDiscountBps:1000,promoterCommissionBps:1000,attributedOrders:0,grossCents:0,earnedCents:0};
  for(const platform of ['web','native'])for(const role of ['owner','admin','editor','scanner',null]){
   reset(role);f.state.promoters=[promoter];const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'promoters');
   try{await flush(()=>app.render());const allowed=role==='owner'||role==='admin';assert.equal(!!node.querySelector('[aria-label="Pause Fixture promoter"]'),allowed,platform+'/'+role+' promoter update');
    assert.ok(f.state.queryKeys.every(key=>key.at(-1)==='viewer'),'promoter and library caches belong to viewer');
    f.state.auth=false;await flush(()=>app.render());assert.ok(!node.textContent.includes('Fixture promoter'));count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const flag of ['pending','staffError','paused']){
   reset('admin');f.state.promoters=[promoter];f.state[flag]=true;const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'promoters');
   try{await flush(()=>app.render());assert.equal(hasButton(node,'Retry'),flag!=='pending');assert.ok(!node.textContent.includes('Fixture promoter'));count++;}
   finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const revoked of [false,true]){
   reset('admin');f.state.promoters=[promoter];const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'promoters');
   try{await flush(()=>app.render());if(revoked)f.state.freshRole='editor';await flush(()=>node.querySelector('[aria-label="Pause Fixture promoter"]').click());
    await flush(()=>node.querySelector('[aria-label="Remove Fixture promoter"]').click());if(platform==='web')await flush(()=>button(node,'Remove').click());
    assert.equal(f.state.mutations.length,revoked?0:2,'fresh promoter downgrade blocks update/remove');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const failure of ['error','paused','logout','switch','missing-target']){
   reset('admin');f.state.promoters=[promoter];const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'promoters');
   try{await flush(()=>app.render());f.state.afterRefetch=()=>{if(failure==='error')f.state.staffError=true;if(failure==='paused')f.state.paused=true;if(failure==='logout')f.state.auth=false;if(failure==='switch')f.state.viewer='other-viewer';if(failure==='missing-target')f.state.freshPromoters=[];};
    await flush(()=>node.querySelector('[aria-label="Pause Fixture promoter"]').click());assert.deepEqual(f.state.mutations,[],platform+'/'+failure+' blocks stale promoter mutation');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const revoked of [false,true]){
   reset('admin');f.state.promoters=[promoter];const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'promoters');
   try{await flush(()=>app.render());await flush(()=>node.querySelector('[aria-label="Add promoter"]').click());
    const field=node.querySelector(platform==='web'?'input[placeholder="Promoter name"]':'input[placeholder="username"]');assert.ok(field);
    await flush(()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(field,'New promoter');field.dispatchEvent(new window.Event('input',{bubbles:true}));});
    if(revoked)f.state.freshRole='editor';await flush(()=>button(node,'Add promoter').click());
    assert.equal(f.state.mutations.filter(x=>x[0]==='promoter-add').length,revoked?0:1,platform+' add requires current owner/admin');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const role of ['owner','admin','editor','scanner',null]){
   reset(role);const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'analytics');
   try{await flush(()=>app.render());assert.equal(node.textContent.includes('Private financial summary'),role==='owner'||role==='admin');
    f.state.auth=false;await flush(()=>app.render());assert.ok(!node.textContent.includes('Private financial summary'),'logout hides cached financial data');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const flag of ['pending','error','paused','staffError']){
   reset();f.state[flag]=true;const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'analytics');
   try{await flush(()=>app.render());assert.ok(!node.textContent.includes('Private financial summary'));count++;}
   finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native'])for(const failure of ['none','downgrade','logout','switch']){
   reset();const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform,'analytics');
   try{await flush(()=>app.render());if(failure==='downgrade')f.state.freshRole='editor';if(failure==='logout')f.state.afterAttendees=()=>f.state.auth=false;if(failure==='switch')f.state.afterAttendees=()=>f.state.viewer='other';
    await flush(()=>node.querySelector('[aria-label="Export attendees as CSV"]').click());assert.equal(f.state.mutations.some(x=>x[0]==='share'),failure==='none');assert.equal(f.state.mutations.some(x=>x[0]==='write'),failure==='none');count++;
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  console.log(`PASS: ${count} mounted organizer/staff/promoter/analytics permission scenarios (offline boundaries)`);
 } finally {fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort();}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
