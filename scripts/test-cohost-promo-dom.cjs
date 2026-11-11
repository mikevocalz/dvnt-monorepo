#!/usr/bin/env node
// Actual promo screens, shared create adapter and web store; offline transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));const window=new Window();
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=require('react-dom/client');
 const state={calls:[],toasts:[],response:null};const noop=()=>{};
 const showToast=(...args)=>state.toasts.push(args);
 const dom=tag=>({children,onPress,onChangeText,...props})=>React.createElement(tag,{
   ...(onPress?{onClick:onPress}:{}),...(onChangeText?{onInput:e=>onChangeText(e.target.value)}:{}),
   ...Object.fromEntries(['value','placeholder','disabled'].filter(k=>props[k]!==undefined).map(k=>[k,props[k]])),
 },children);
 const query={select:()=>query,eq:()=>query,is:()=>query,order:async()=>({data:[],error:null})};
 const fixtures={
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),zustand:require('zustand'),
  'solito/navigation':{useParams:()=>({id:'42'}),useRouter:()=>({back:noop})},
  'expo-router':{useLocalSearchParams:()=>({id:'42'}),useRouter:()=>({back:noop})},
  '@tanstack/react-query':{useQuery:()=>({data:[],isLoading:false}),useQueryClient:()=>({invalidateQueries:noop}),useMutation:options=>({isPending:false,mutate:arg=>Promise.resolve().then(()=>options.mutationFn(arg)).then(options.onSuccess,options.onError)})},
  '@tanstack/react-virtual':{useVirtualizer:()=>({getVirtualItems:()=>[],getTotalSize:()=>0})},
  '@dvnt/app/lib/supabase/client':{supabase:{from:name=>{assert.equal(name,'promo_codes');return query;}}},
  '@dvnt/app/lib/api/invoke-edge':{invokeEdge:async(...args)=>{state.calls.push(args);return state.response;}},
  '@dvnt/app/lib/stores/ui-store':{useUIStore:selector=>selector({showToast})},
  '@dvnt/app/lib/hooks':{useColorScheme:()=>({colors:{}})},
  '@dvnt/app/components/error-boundary':{ErrorBoundary:dom('div')},
  '@dvnt/app/components/layout/detail-header':{DetailBackButton:()=>null},
  '@dvnt/ui':{FormField:({children,label})=>React.createElement('label',null,label,children),Dialog:({open,children,footer})=>open?React.createElement('section',null,children,footer):null},
  'react-native-safe-area-context':{SafeAreaView:dom('div')},
  'react-native':{View:dom('div'),Text:dom('span'),Pressable:dom('button'),TextInput:dom('input'),ScrollView:dom('div'),ActivityIndicator:()=>null,RefreshControl:()=>null,Alert:{alert:()=>{throw Error('unexpected deletion')}}},
 };
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,console:{error:noop},require:name=>{
   if(fixtures[name])return fixtures[name];
   if(name==='./invoke-edge')return fixtures['@dvnt/app/lib/api/invoke-edge'];
   if(name==='@dvnt/app/lib/stores/promo-codes-ui-store'||name==='@dvnt/app/lib/api/promo-codes')return load('packages/app/'+name.slice(10)+'.ts');
   if(name.startsWith('lucide-'))return new Proxy({},{get:()=>()=>null});
   throw Error('unexpected import '+name);
  }},{filename:file});return module.exports;
 }
 const web=load('packages/app/features/events/promo-codes.web.tsx').EventPromoCodesScreen;
 const native=load('packages/app/features/routes/screens/(protected)/events/[id]/promo-codes.tsx').default;
 const store=load('packages/app/lib/stores/promo-codes-ui-store.ts').usePromoCodesUIStore;
 const flush=async fn=>React.act(async()=>{await fn?.();await new Promise(r=>setTimeout(r,0));});
 let count=0;
 for(const [platform,Component] of [['web',web],['native',native]])for(const mode of ['success','duplicate','denied','offline']){
  state.calls=[];state.toasts=[];state.response=mode==='success'?{data:{ok:true,promo:{id:'fixture',code:'COHOST15'}}}:{error:{message:mode,status:mode==='duplicate'?409:mode==='denied'?403:undefined}};
  store.getState().resetForm();store.getState().setShowCreate(false);
  const node=document.createElement('div');document.body.append(node);const view=createRoot(node);
  const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  try{
   await flush(()=>view.render(React.createElement(Component)));
   await flush(()=>button('New').click());
   if(platform==='web')await flush(()=>{store.getState().setNewCode('cohost15');store.getState().setDiscountValue('15');});
   else for(const [placeholder,value] of [['CODE (e.g. EARLYBIRD)','cohost15'],['e.g. 20','15']]){
    const field=[...node.querySelectorAll('input')].find(x=>x.placeholder===placeholder);assert.ok(field);
    await flush(()=>{field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));});
   }
   await flush(()=>button(platform==='web'?'Create':'Create Promo Code').click());
   assert.equal(state.calls.length,1,platform+'/'+mode);
   assert.deepEqual(JSON.parse(JSON.stringify(state.calls[0])),['manage-promo-code',{action:'create',event_id:42,code:'COHOST15',discount_type:'percent',discount_value:15,max_uses:null}]);
   assert.equal(state.toasts.at(-1)[0],mode==='success'?'success':'error');
   if(mode==='duplicate')assert.equal(state.toasts.at(-1)[1],'Duplicate');
   if(mode!=='success')assert.ok(node.querySelector('input'),'failed creation preserves form');
   count++;
  }finally{await flush(()=>view.unmount());node.remove();}
 }
 console.log(`Passed ${count} mounted promo create/error cases across web and native.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
