#!/usr/bin/env node
/** Offline mounted web/native analytics, real API adapter, query cache and UI store. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const deps=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);
const resolve=n=>require.resolve(n,{paths:[ROOT,...deps]});
const {build}=require(resolve('esbuild'));
const fixtures={
 'analytics-fixture':`import {create} from 'zustand';export const useRoute=create(()=>({id:'17'}));export const useActor=create(()=>({user:{id:'fixture-a'},isAuthenticated:true}));export const state={payload:null,error:null,calls:[],defer:false,releases:[]};export const router={push(){},back(){}};`,
 'solito/navigation':`import {router,useRoute} from 'analytics-fixture';export const useParams=()=>useRoute();export const useRouter=()=>router;`,
 'expo-router':`import {router,useRoute} from 'analytics-fixture';export const useLocalSearchParams=()=>useRoute();export const useRouter=()=>router;`,
 '@dvnt/app/lib/stores/auth-store':`export {useActor as useAuthStore} from 'analytics-fixture';`,
 '@dvnt/app/lib/hooks/use-event-role':`export const useEventRole=()=>({role:'owner',hasResolved:true,isPending:false,isPaused:false,isError:false,refetch:async()=>({isSuccess:true,data:'owner',fetchStatus:'idle'})});`,
 '@dvnt/app/lib/api/promoters':`export const promotersApi={leaderboard:async()=>[]};`,
 '@dvnt/app/lib/stores/ui-store':`export const useUIStore=s=>s({showToast(){}});`,
 '@dvnt/app/lib/hooks':`export const useColorScheme=()=>({colors:{background:'#000',card:'#111',foreground:'#fff',mutedForeground:'#aaa',primary:'#0cf',border:'#333'}});`,
 '@dvnt/app/components/error-boundary':`export const ErrorBoundary=({children})=>children;`,
 '@dvnt/app/components/ui/screen-skeleton':`export const ScreenSkeleton=()=> <span>Loading analytics</span>;`,
 '@dvnt/app/components/layout/detail-header':`export const DetailBackButton=()=>null;`,
 'expo-sharing':`export const isAvailableAsync=async()=>false;export const shareAsync=async()=>{throw Error('Unexpected export');};`,
 'expo-file-system/legacy':`export const cacheDirectory='fixture';export const EncodingType={UTF8:'utf8'};export const writeAsStringAsync=async()=>{throw Error('Unexpected export');};`,
 'react-native':`export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=({children,refreshControl})=><div>{refreshControl}{children}</div>;export const Pressable=({children,onPress,disabled,accessibilityLabel})=><button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>{children}</button>;export const RefreshControl=({onRefresh})=><button onClick={onRefresh}>Refresh analytics</button>;export const StyleSheet={create:s=>s};`,
 'react-native-safe-area-context':`export const SafeAreaView=({children})=><div>{children}</div>;`,
 'analytics-invoke':`import {state} from 'analytics-fixture';export async function invokeEdge(name,body){state.calls.push({name,body});const payload=state.payload,error=state.error;if(state.defer)await new Promise(r=>state.releases.push(r));return error?{error:{message:error}}:{data:{ok:true,...payload}};}`,
};
const icons=['ArrowLeft','DollarSign','Ticket','CheckCircle2','TrendingUp','Tag','AlertCircle','Download'];
fixtures['lucide-react']=fixtures['lucide-react-native']=icons.map(n=>`export const ${n}=()=>null;`).join('\n');
const entry=`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {state,useRoute,useActor} from 'analytics-fixture';import {useEventAnalyticsStore as store} from './packages/app/lib/stores/event-analytics-store';import {EventAnalyticsScreen as Web} from './packages/app/features/events/analytics.web';import Native from './packages/app/features/routes/screens/(protected)/events/[id]/analytics';export {state,store,act,useRoute,useActor};export const mount=(node,platform)=>{const root=createRoot(node);const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});return {render:()=>root.render(<QueryClientProvider client={client}>{platform==='web'?<Web/>:<Native/>}</QueryClientProvider>),unmount:()=>{root.unmount();client.clear();},refresh:()=>client.invalidateQueries({queryKey:['event-analytics']})};};`;
const summary={eventId:'17',title:'Synthetic event',revenue:{grossCents:800000,refundsCents:0,dvntFeeCents:999999,stripeFeeCents:20000,netCents:600000,calculatedAt:'2026-11-02T12:00:00Z'},ticketStats:{total:10,active:8,checkedIn:2,refunded:0,void:0,transferPending:0},attendanceBreakdown:{rsvp:3,paid:7,total:10},tiers:[],promoCodes:[]};
const ledger={month:'2026-10',timeZone:'America/New_York',start:'2026-10-01T04:00:00Z',end:'2026-11-01T04:00:00Z',asOf:'2026-11-02T21:00:00Z',currency:'usd',paidOrders:10,chargedOrders:9,excludedPartiallyRefundedOrders:1,checkoutCents:850000,buyerFeeCents:150123,organizerFeeCents:150123,grossPlatformFeeCents:300246,stripeFeeCents:100001,afterStripeFeeCents:200245,provisional:true};
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://analytics-fixture.invalid'});
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-analytics-'));let count=0;
 try{
  await build({stdin:{contents:entry,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'test.cjs'),nodePaths:deps,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},
   alias:Object.fromEntries(['react','react-dom','zustand','@tanstack/react-query'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),
   plugins:[{name:'offline-analytics',setup(b){b.onResolve({filter:/.*/},a=>{if(a.path==='./invoke-edge'&&a.importer.endsWith('/event-analytics.ts'))return {path:'analytics-invoke',namespace:'fixture'};if(Object.hasOwn(fixtures,a.path))return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
  const f=require(path.join(dir,'test.cjs'));const flush=fn=>f.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,15));});
  for(const platform of ['web','native'])for(const mode of ['ready','missing','null','wrong-month']){
   f.store.setState({month:'2026-10'});f.state.calls=[];
   f.state.payload={...summary,...(mode==='missing'?{}:{monthlyPlatformFees:mode==='null'?null:{...ledger,...(mode==='wrong-month'?{month:'2026-09'}:{})}})};
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{await flush(()=>app.render());await flush();const text=node.textContent;
    assert.match(text,/Attendance/);assert.match(text,/DVNT platform fees/);
    assert.ok(f.state.calls.some(c=>c.name==='event-analytics'&&c.body.event_id==='17'&&c.body.month==='2026-10'));
    assert.doesNotMatch(text,/final calculated fee/);
    if(mode==='ready'){
      assert.match(text,/\$2002\.45/,'exact cents survive native and web rendering');
      assert.match(text,/\$3002\.46/);assert.match(text,/partially refunded/);assert.match(text,/not reconciled/);assert.match(text,/Checked/);
    }else{
      assert.match(text,/ledger unavailable/i);assert.doesNotMatch(text,/\$2002\.45/);const heading=[...node.querySelectorAll('h2,span')].find(e=>e.textContent==='DVNT platform fees · monthly');const monthly=heading.closest('section')||heading.parentElement;assert.doesNotMatch(monthly.textContent,/\$9999\.99/,'do not fall back to legacy reconstructed fees');
    }
    count++;console.log(`ok ${count} - ${platform} ${mode}: monthly precision or fail-closed section, attendance preserved`);
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native']){
   f.store.setState({month:'2026-10'});f.state.payload={...summary,monthlyPlatformFees:ledger};f.state.defer=true;f.state.releases=[];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{
    await flush(()=>app.render());
    f.state.payload={...summary,monthlyPlatformFees:{...ledger,month:'2026-09',afterStripeFeeCents:12345}};f.state.defer=false;
    await flush(()=>f.store.setState({month:'2026-09'}));await flush();assert.match(node.textContent,/\$123\.45/);
    await flush(()=>f.state.releases.splice(0).forEach(r=>r()));assert.match(node.textContent,/\$123\.45/);assert.doesNotMatch(node.textContent,/\$2002\.45/);
    f.state.payload={...summary,monthlyPlatformFees:null};await flush(()=>app.refresh());await flush();
    assert.match(node.textContent,/ledger unavailable/i);assert.match(node.textContent,/Attendance/);assert.doesNotMatch(node.textContent,/\$123\.45/);
    count++;console.log(`ok ${count} - ${platform}: stale month response cannot replace selection; failed ledger refresh removes stale money`);
   }finally{f.state.defer=false;await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native']){
   f.useRoute.setState({id:'17'});f.useActor.setState({user:{id:'fixture-a'}});f.store.setState({month:'2026-10'});
   f.state.payload={...summary,monthlyPlatformFees:ledger};f.state.error=null;f.state.defer=true;f.state.releases=[];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{
    await flush(()=>app.render());
    f.state.defer=false;f.state.payload={...summary,eventId:'18',monthlyPlatformFees:{...ledger,afterStripeFeeCents:12345}};
    await flush(()=>f.useRoute.setState({id:'18'}));await flush();assert.match(node.textContent,/\$123\.45/);
    await flush(()=>f.state.releases.splice(0).forEach(r=>r()));assert.match(node.textContent,/\$123\.45/);assert.doesNotMatch(node.textContent,/\$2002\.45/);
    f.state.error='Not your event';f.state.defer=true;
    await flush(()=>f.useActor.setState({user:{id:'fixture-b'}}));assert.doesNotMatch(node.textContent,/\$123\.45/,'cached finance cannot cross account boundary before refetch finishes');
    const log=console.error;console.error=()=>{};try{await flush(()=>{f.state.defer=false;f.state.releases.splice(0).forEach(r=>r());});await flush();}finally{console.error=log;}
    assert.doesNotMatch(node.textContent,/\$123\.45/);assert.doesNotMatch(node.textContent,/Attendance/);
    await flush(()=>f.useActor.setState({user:null}));assert.doesNotMatch(node.textContent,/\$123\.45/);
    count++;console.log(`ok ${count} - ${platform}: late event response stays isolated; changed account and logout cannot see cached money`);
   }finally{f.state.defer=false;f.state.error=null;await flush(()=>app.unmount());node.remove();}
  }
  console.log(`PASS ${count} actual analytics UI scenarios (offline API boundary)`);
 }finally{fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
