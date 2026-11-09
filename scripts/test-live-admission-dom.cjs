#!/usr/bin/env node
// Production live screen with synthetic database/realtime boundaries only.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),nodePaths=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.resolve(p));
const resolve=n=>require.resolve(n,{paths:[ROOT,...nodePaths]});
const mocks={
 'fixture':`export const state={scans:[],update:null,tiers:{},fail:false};export const channel={on(_kind,config,run){if(config.event==='UPDATE')state.update=run;return this},subscribe(run){run('SUBSCRIBED');return this}};`,
 '@dvnt/app/lib/supabase/client':`import {state} from 'fixture';export const supabase={removeChannel(){},from(table){let filters={},head=false;const q={select(_value,opts){head=!!opts?.head;return q},eq(key,value){filters[key]=value;return q},in(){return q},gte(){return q},order(){return q},limit(){return q},async maybeSingle(){if(table==='events')return{data:{title:'Fixture live event'}};if(state.fail)throw Error('offline');return{data:state.tiers[filters.id]??null}},then(resolve){return Promise.resolve(head?{count:state.scans.length}:{data:state.scans}).then(resolve)}};return q}};`,
 '@dvnt/app/lib/supabase/realtime':`import {channel} from 'fixture';export const freshChannel=()=>channel;`,
 'expo-router':`export const useLocalSearchParams=()=>({id:'17'});export const useRouter=()=>({});`,
 'react-native':`export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=View;export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;export const StyleSheet={create:x=>x};export const ActivityIndicator=()=>null;`,
 'react-native-safe-area-context':`export {View as SafeAreaView} from 'react-native';`,
 'lucide-react-native':`export const Radio=()=>null;export const ScanLine=()=>null;`,
 '@dvnt/app/components/layout/detail-header':`export const DetailBackButton=()=>null;`,
};
(async()=>{
 const {Window}=await import(resolve('happy-dom'));const window=new Window({url:'https://live-fixture.invalid'});Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-admission-'));let renderer,f;
 try{
  await require(resolve('esbuild')).build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`export {default as React,act} from 'react';export {createRoot} from 'react-dom/client';export {default as Live} from './packages/app/features/routes/screens/(protected)/events/[id]/live';export {state} from 'fixture';`},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'app.cjs'),nodePaths,alias:Object.fromEntries(['react','react-dom'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},plugins:[{name:'offline-live',setup(b){b.onResolve({filter:/.*/},a=>{if(Object.hasOwn(mocks,a.path))return{path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/')){const p=path.join(ROOT,'packages/app',a.path.slice(10));for(const x of ['.ts','.tsx'])if(fs.existsSync(p+x))return{path:p+x};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:ROOT}));}}]});
  f=require(path.join(dir,'app.cjs'));const flush=async run=>f.act(async()=>{if(run)await run();await new Promise(r=>setTimeout(r,10));});
  const stamp=new Date().toISOString();f.state.scans=[{id:'admission',category:'admission',ticket_type_id:'ga',ticket_types:{category:'admission',name:'Admission'},checked_in_at:stamp,qr_token:'admstart'},{id:'service',category:'admission',ticket_type_id:'coat',ticket_types:{category:'service',name:'Coat check'},checked_in_at:stamp,qr_token:'srvstart'}];f.state.tiers={ga:{category:'admission',name:'Admission'},coat:{category:'service',name:'Coat check'}};
  const host=document.createElement('div');document.body.append(host);renderer=f.createRoot(host);await flush(()=>renderer.render(f.React.createElement(f.Live)));await flush();
  assert.match(host.textContent,/admstart/);assert.doesNotMatch(host.textContent,/srvstart|Coat check/);
  const latestCount=()=>[...host.querySelectorAll('span')].find(x=>x.textContent==='ADMISSION SCANS · LAST 5 MIN').parentElement.children[1].textContent;
  assert.equal(latestCount(),'1');
  const update=(id,tier,token)=>f.state.update({old:{status:'active'},new:{id,ticket_type_id:tier,category:'admission',status:'scanned',checked_in_at:stamp,qr_token:token}});
  await flush(()=>update('service-new','coat','srvnew'));assert.doesNotMatch(host.textContent,/srvnew/);assert.equal(latestCount(),'1');
  await flush(()=>update('admission-new','ga','admnew'));assert.match(host.textContent,/admnew/);assert.equal(latestCount(),'2');
  f.state.fail=true;await flush(()=>update('unknown','missing','unknown'));assert.doesNotMatch(host.textContent,/unknown/);assert.equal(latestCount(),'2');
  console.log('PASS: actual live bootstrap and realtime admission feed exclude service redemptions, including legacy admission stamps and failed purpose lookups');
 }finally{if(renderer&&f)await f.act(()=>renderer.unmount());await window.happyDOM.abort();fs.rmSync(dir,{recursive:true,force:true});}
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
