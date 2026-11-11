#!/usr/bin/env node
/** Mount production order detail entry buttons with both default-off gates. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const dependencyPaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolveDependency = name => require.resolve(name, {paths:[ROOT,...dependencyPaths]});
const {build} = require(resolveDependency('esbuild'));
const fixture = {
  'order-test-fixture': `export const state={order:null,navigations:[]};export const router={back:()=>{},push:path=>state.navigations.push(path)};export const navigation={setOptions:()=>{}};`,
  'solito/navigation': `export {router as _router} from 'order-test-fixture';import {router} from 'order-test-fixture';export const useParams=()=>({id:'order-a'});export const useRouter=()=>router;`,
  'expo-router': `import {router,navigation} from 'order-test-fixture';export const useLocalSearchParams=()=>({id:'order-a'});export const useRouter=()=>router;export const useNavigation=()=>navigation;`,
  '@dvnt/app/lib/api/payments': `import {state} from 'order-test-fixture';export const purchasesApi={getOrder:async()=>state.order};`,
  'react-native': `export const View=({children})=><div>{children}</div>;export const Text=({children})=><span>{children}</span>;export const ScrollView=View;export const Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  'react-native-reanimated': `import {View} from 'react-native';const animation={duration:()=>animation,delay:()=>animation,springify:()=>animation,damping:()=>animation};export const FadeIn=animation;export const FadeInDown=animation;export default {View};`,
  'expo-haptics': `export const impactAsync=()=>{};export const ImpactFeedbackStyle={Light:'light'};`,
  '@dvnt/app/components/settings-back-button': `export const SettingsCloseButton=()=>null;`,
  '@dvnt/app/components/skeletons': `export const OrderDetailSkeleton=()=>null;`,
  '@dvnt/app/lib/stores/ui-store': `const showToast=()=>{};export const useUIStore=selector=>selector({showToast});`,
  '@dvnt/app/lib/print/print-utils': `export const printHtml=async()=>{throw Error('Unexpected print');};export const shareHtmlAsPdf=printHtml;`,
  '@dvnt/app/lib/print/thermal-templates': `export const receiptPdfHtml=()=>'';`,
};
fixture['lucide-react'] = fixture['lucide-react-native'] = ['Receipt','Printer','Share2','RotateCcw','HelpCircle','ChevronRight','CheckCircle','Clock','AlertCircle','CreditCard','Ticket','ExternalLink'].map(name=>`export const ${name}=()=>null;`).join('\n');
const source = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';
import {OrderDetailScreen} from './packages/app/features/settings/order-detail.web';
import NativeOrderScreen from './packages/app/features/routes/screens/settings/order/[id]';
import {usePaymentsStore} from './packages/app/lib/stores/payments-store';
import {state} from 'order-test-fixture';export {state,act,usePaymentsStore};
export const mount=(node,platform)=>{const root=createRoot(node);return {render:()=>root.render(<React.StrictMode>{platform==='web'?<OrderDetailScreen/>:<NativeOrderScreen/>}</React.StrictMode>),unmount:()=>root.unmount()};};`;

function order(total=0, extra={}) {
  return {id:'order-a',status:'paid',type:'event_ticket',currency:'usd',
    fees:{subtotalCents:total,platformFeeCents:0,processingFeeCents:0,taxCents:0,totalCents:total},
    event:{id:'event-a',title:'RSVP event'},timeline:[],tickets:[],receiptAvailable:true,
    createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',...extra};
}
(async()=>{
  const {Window}=await import(resolveDependency('happy-dom'));
  const window = new Window({url:'https://order-fixture.invalid'});
  Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'order-refund-'));
  let count=0;
  try {
    await build({stdin:{contents:source,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',
      outfile:path.join(dir,'test.cjs'),nodePaths:dependencyPaths,define:{__DEV__:'false'},
      alias:Object.fromEntries(['react','react-dom','zustand'].map(name=>[name,path.dirname(resolveDependency(name+'/package.json'))])),
      tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},plugins:[{name:'offline-order-actions',setup(b){
        b.onResolve({filter:/.*/},a=>{
          if(Object.hasOwn(fixture,a.path))return {path:a.path,namespace:'fixture'};
          if(a.path.startsWith('@dvnt/app/')){
            const stem=path.join(ROOT,'packages/app',a.path.slice(10));
            for(const suffix of ['','.ts','.tsx'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};
          }
        });
        b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixture[a.path],loader:'tsx',resolveDir:ROOT}));
      }}]});
    const f=require(path.join(dir,'test.cjs'));
    const flush=async run=>f.act(async()=>{await run?.();await new Promise(resolve=>setTimeout(resolve,0));});
    const entry=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Review replacement checkout');
    for(const platform of ['web','native']){
      for(const enabled of [false,true])for(const permitted of [undefined,false,true]){
        process.env.NEXT_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED=String(enabled);process.env.EXPO_PUBLIC_CHECKOUT_REPLACEMENT_ENABLED=String(enabled);
        const node=document.createElement('div');document.body.append(node);Object.assign(f.state,{order:order(1000,{status:'payment_failed',canReviewCheckoutReplacement:permitted}),navigations:[]});
        const app=f.mount(node,platform);
        try{await flush(()=>app.render());assert.equal(Boolean(entry()),enabled&&permitted===true);
          if(entry()){await flush(()=>entry().click());assert.deepEqual(f.state.navigations,[platform==='web'?'/feed/checkout/retry?order_id=order-a':'/(protected)/checkout/retry?order_id=order-a']);}
          count++;
        }finally{await flush(()=>app.unmount());node.remove();}
      }
    }
    console.log(`PASS: ${count} mounted default-off replacement-entry cases`);
  }finally{fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort();}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
