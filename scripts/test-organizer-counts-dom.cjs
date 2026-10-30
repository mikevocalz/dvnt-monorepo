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
 '@dvnt/app/lib/api/organizer':`export const organizerApi={refundTicket:()=>{throw Error('No mutations in count test');}};`,
 '@dvnt/app/lib/api/event-drafts':`export const eventDraftsApi={duplicateEvent:()=>{throw Error('No mutations in count test');}};`,
 '@dvnt/app/lib/stores/ui-store':`import {state} from 'count-fixture';const ui={showToast:(...x)=>state.toasts.push(x)};export const useUIStore=selector=>selector(ui);`,
 '@dvnt/app/lib/stores/offline-checkin-store':`import {offline} from 'count-fixture';export const useOfflineCheckinStore=()=>offline;`,
 '@dvnt/app/lib/hooks':`export const useColorScheme=()=>({colors:{background:'#000',foreground:'#fff',mutedForeground:'#aaa',primary:'#0cf',border:'#333'}});`,
 '@dvnt/app/components/error-boundary':`export const ErrorBoundary=({children})=>children;`,
 '@dvnt/app/components/layout/detail-header':`export const DetailBackButton=()=>null;`,
 '@tanstack/react-virtual':`export const useVirtualizer=({count})=>({getTotalSize:()=>count*96,getVirtualItems:()=>Array.from({length:Math.min(count,3)},(_,index)=>({index,key:index,start:index*96})),measureElement:()=>{}});`,
 'react-native':`export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=({children,refreshControl})=><div>{refreshControl}{children}</div>;export const Pressable=({children,onPress,disabled})=><button onClick={onPress} disabled={disabled}>{children}</button>;export const RefreshControl=({onRefresh})=><button onClick={onRefresh}>Refresh roster</button>;export const ActivityIndicator=()=> <span>Loading</span>;export const Alert={alert:()=>{throw Error('Unexpected dialog');}};`,
 'react-native-safe-area-context':`export const SafeAreaView=({children})=><div>{children}</div>;`,
};
const icons=['ArrowLeft','BarChart3','CheckCircle','Clock','CloudUpload','Megaphone','QrCode','Settings','Tag','Undo2','User','Users','WifiOff','XCircle','CopyPlus','Nfc'];
fixtures['lucide-react']=fixtures['lucide-react-native']=icons.map(n=>`export const ${n}=()=>null;`).join('\n');
const entry=`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import {state,useRoute} from 'count-fixture';import {EventOrganizerScreen as Web} from './packages/app/features/events/organizer.web';import Native from './packages/app/features/routes/screens/(protected)/events/[id]/organizer';export {state,useRoute,act};export const mount=(node,platform)=>{const root=createRoot(node);return {render:()=>root.render(<React.StrictMode>{platform==='web'?<Web/>:<Native/>}</React.StrictMode>),unmount:()=>root.unmount()};};`;
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://organizer-fixture.invalid'});
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'organizer-counts-'));let count=0;
 try{
  await build({stdin:{contents:entry,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'test.cjs'),nodePaths:deps,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},
   alias:Object.fromEntries(['react','react-dom','zustand'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),
   plugins:[{name:'offline-counts',setup(b){b.onResolve({filter:/.*/},a=>{if(Object.hasOwn(fixtures,a.path))return {path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
  const f=require(path.join(dir,'test.cjs'));const flush=fn=>f.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,0));});
  const stat=label=>{const text=[...document.querySelectorAll('span')].find(e=>e.textContent.trim()===label);assert.ok(text,`Missing ${label}`);return Number.parseInt(text.parentElement.textContent.trim(),10);};
  for(const platform of ['web','native'])for(const total of [0,205,1207]){
   const rows=Array.from({length:total},(_,i)=>({id:`synthetic-ticket-${i}`,event_id:17,status:'active',purchase_amount_cents:0,created_at:'2026-01-01T00:00:00Z',createdAt:'2026-01-01T00:00:00Z',checked_in_at:null,holder_name:'Fixture holder'}));
   if(total){rows[0].status='scanned';rows[1].checked_in_at='2026-01-02T00:00:00Z';rows[2].status='refunded';rows[3].status='void';rows[4].status='transfer_pending';rows[5].status='refunded';rows[5].checked_in_at='2026-01-02T00:00:00Z';}
   f.state.rows=rows;f.state.calls=[];f.state.toasts=[];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{await flush(()=>app.render());await flush();
    assert.equal(stat('Issued tickets'),total);
    assert.equal(stat('Checked In'),total?3:0);
    assert.equal(stat('Awaiting check-in'),total?total-5:0);
    assert.ok(f.state.calls.length>0&&f.state.calls.every(id=>id==='17'));
    assert.equal(f.state.toasts.length,0);count++;console.log(`ok ${count} - ${platform}: ${total} issued rows preserve check-in and terminal semantics`);
   }finally{await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native']) {
   f.state.rows=Array.from({length:205},(_,i)=>({id:`retry-ticket-${i}`,event_id:17,status:'active',createdAt:'2026-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z'}));
   f.state.fail=true;f.state.defer=true;f.state.releases=[];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   const findButton=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
   const assertUnknown=()=>{for(const label of ['Issued tickets','Checked In','Awaiting check-in'])assert.ok(Number.isNaN(stat(label)),`${platform}: ${label} must not claim zero or stale totals`);};
   try{
    await flush(()=>app.render());assertUnknown();
    const savedError=console.error;console.error=()=>{};
    try{await flush(()=>{f.state.defer=false;f.state.releases.splice(0).forEach(resolve=>resolve());});}finally{console.error=savedError;}
    assert.match(document.body.textContent,/Ticket counts unavailable/);assertUnknown();assert.ok(!document.body.textContent.includes('No tickets yet'));
    assert.ok([...document.querySelectorAll('button')].some(b=>/Download/.test(b.textContent)), 'offline download remains accessible');
    f.state.fail=false;await flush(()=>findButton('Retry').click());await flush();assert.equal(stat('Issued tickets'),205);assert.equal(stat('Awaiting check-in'),205);
    f.state.fail=true;console.error=()=>{};
    try{await flush(()=>findButton(platform==='web'?'Refresh':'Refresh roster').click());}finally{console.error=savedError;}
    assert.match(document.body.textContent,/Ticket counts unavailable/);assertUnknown();
    f.state.fail=false;await flush(()=>findButton('Retry').click());await flush();assert.equal(stat('Issued tickets'),205);
    count++;console.log(`ok ${count} - ${platform}: loading and failed refresh do not claim zero/stale counts; retry recovers`);
   }finally{f.state.fail=false;f.state.defer=false;await flush(()=>app.unmount());node.remove();}
  }
  for(const platform of ['web','native']) {
   f.useRoute.setState({id:'17'});f.state.rows=Array.from({length:205},(_,i)=>({id:`old-${i}`,status:'active'}));f.state.defer=true;f.state.releases=[];
   const node=document.createElement('div');document.body.append(node);const app=f.mount(node,platform);
   try{
    await flush(()=>app.render());
    f.state.defer=false;f.state.rows=Array.from({length:13},(_,i)=>({id:`new-${i}`,status:'active'}));
    await flush(()=>f.useRoute.setState({id:'18'}));await flush();assert.equal(stat('Issued tickets'),13);
    await flush(()=>f.state.releases.splice(0).forEach(resolve=>resolve()));assert.equal(stat('Issued tickets'),13,'late previous-event response cannot replace current counts');
    count++;console.log(`ok ${count} - ${platform}: stale previous-event completions cannot replace current counts`);
   }finally{f.state.defer=false;await flush(()=>app.unmount());node.remove();}
  }
  console.log(`PASS: ${count} mounted actual organizer screen count scenarios (offline API boundary)`);
 }finally{fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort();}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
