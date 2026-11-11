#!/usr/bin/env node
// Actual promo screens, shared create adapter and web store; offline transport.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));const window=new Window();
 Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=require('react-dom/client');
 const state={calls:[],toasts:[],response:null, role:'editor', freshRole:'editor', authenticated:true, pending:false, error:false, paused:false, refetches:0, rows:[]};const noop=()=>{};
 const showToast=(...args)=>state.toasts.push(args);
 const dom=tag=>({children,onPress,onChangeText,...props})=>React.createElement(tag,{
   ...(onPress?{onClick:onPress}:{}),...(onChangeText?{onInput:e=>onChangeText(e.target.value)}:{}),
   ...(props.accessibilityLabel?{'aria-label':props.accessibilityLabel}:{}),
   ...Object.fromEntries(['value','placeholder','disabled'].filter(k=>props[k]!==undefined).map(k=>[k,props[k]])),
 },children);
 const query={select:()=>query,eq:()=>query,is:()=>query,order:async()=>({data:state.rows,error:null})};
 const fixtures={
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),zustand:require('zustand'),
  'solito/navigation':{useParams:()=>({id:'42'}),useRouter:()=>({back:noop})},
  'expo-router':{useLocalSearchParams:()=>({id:'42'}),useRouter:()=>({back:noop})},
  '@tanstack/react-query':{useQuery:options=>{state.queryKey=options.queryKey;return {data:state.rows,isLoading:false}},useQueryClient:()=>({invalidateQueries:noop}),useMutation:options=>({isPending:false,mutate:arg=>Promise.resolve().then(()=>options.mutationFn(arg)).then(options.onSuccess,options.onError)})},
  '@tanstack/react-virtual':{useVirtualizer:()=>({getVirtualItems:()=>state.rows.map((_,index)=>({index,key:index,start:index*96})),getTotalSize:()=>state.rows.length*96})},
  '@dvnt/app/lib/supabase/client':{supabase:{from:name=>{assert.equal(name,'promo_codes');return query;}}},
  '@dvnt/app/lib/api/invoke-edge':{invokeEdge:async(...args)=>{state.calls.push(args);return state.response;}},
  '@dvnt/app/lib/stores/ui-store':{useUIStore:selector=>selector({showToast})},
  '@dvnt/app/lib/hooks/use-event-role':{useEventRole:()=>({role:state.role,hasResolved:!state.pending&&!state.error&&!state.paused,isPending:state.pending,isError:state.error,isPaused:state.paused,refetch:async()=>{state.refetches++;return {data:state.freshRole,isSuccess:!state.error};}})},
  '@dvnt/app/lib/stores/auth-store':{useAuthStore:Object.assign(selector=>selector({user:{id:'viewer'},isAuthenticated:state.authenticated}),{getState:()=>({user:{id:'viewer'},isAuthenticated:state.authenticated})})},
  '@dvnt/app/lib/events/event-role':{canEditEvent:role=>['owner','admin','editor'].includes(role),canManageStaff:role=>['owner','admin'].includes(role)},
  '@dvnt/app/lib/hooks':{useColorScheme:()=>({colors:{}})},
  '@dvnt/app/components/error-boundary':{ErrorBoundary:dom('div')},
  '@dvnt/app/components/layout/detail-header':{DetailBackButton:()=>null},
  '@dvnt/ui':{FormField:({children,label})=>React.createElement('label',null,label,children),Dialog:({open,children,footer})=>open?React.createElement('section',null,children,footer):null},
  'react-native-safe-area-context':{SafeAreaView:dom('div')},
  'react-native':{View:dom('div'),Text:dom('span'),Pressable:dom('button'),TextInput:dom('input'),ScrollView:dom('div'),ActivityIndicator:()=>null,RefreshControl:()=>null,Alert:{alert:(_title,_message,buttons)=>{state.confirmDelete=buttons.find(b=>b.text==='Delete')?.onPress;}}},
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
 // Mounted entry gates cover every role plus unresolved/error/offline sessions.
 for(const [platform,Component] of [['web',web],['native',native]]) {
  for(const fixture of [
   {role:'owner',allowed:true},{role:'admin',allowed:true},{role:'editor',allowed:true},
   {role:'scanner'},{role:null},{role:null,label:'pending invitation'},{role:null,label:'removed'},
   {role:'editor',pending:true},{role:'editor',error:true},{role:'editor',paused:true},
   {role:'editor',authenticated:false},
  ]) {
   Object.assign(state,{role:null,freshRole:null,authenticated:true,pending:false,error:false,paused:false,calls:[]},fixture);
   const node=document.createElement('div');document.body.append(node);const view=createRoot(node);
   await flush(()=>view.render(React.createElement(Component)));
   assert.equal([...node.querySelectorAll('button')].some(b=>b.textContent.trim()==='New'),!!fixture.allowed,platform+'/'+JSON.stringify(fixture));
   assert.equal(state.calls.length,0);
   if(fixture.error||fixture.paused)assert.match(node.textContent,/Retry/);
   await flush(()=>view.unmount());node.remove();count++;
  }
  // Editors can create but cannot revoke; owner/admin see the revoke control.
  state.rows=[{id:'fixture-code',code:'EXISTING',discount_type:'percent',discount_value:10,uses_count:0,max_uses:null}];
  for(const role of ['owner','admin','editor']) {
   Object.assign(state,{role,freshRole:role,authenticated:true,pending:false,error:false,paused:false});
   const node=document.createElement('div');document.body.append(node);const view=createRoot(node);
   await flush(()=>view.render(React.createElement(Component)));
   const remove=[...node.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.getAttribute('accessibilityLabel'))==='Delete EXISTING');
   assert.equal(!!remove,role!=='editor',platform+'/'+role+' revoke');
   if(platform==='web')assert.deepEqual(JSON.parse(JSON.stringify(state.queryKey)),['event-promo-codes',42,'viewer']);
   if(remove) {
    state.calls=[];state.freshRole='editor';
    await flush(()=>remove.click());
    if(platform==='native')await flush(()=>state.confirmDelete());
    else {
     const confirm=[...node.querySelectorAll('button')].find(b=>b.textContent.trim()==='Delete');
     assert.ok(confirm);await flush(()=>confirm.click());
    }
    assert.equal(state.calls.length,0,'fresh downgrade prevents revoke');
    assert.equal(state.toasts.at(-1)[0],'error');
   }
   await flush(()=>view.unmount());node.remove();count++;
  }
  state.rows=[];
  // Access revoked between opening the form and pressing Create: refetch denies.
  Object.assign(state,{role:'editor',freshRole:null,authenticated:true,pending:false,error:false,paused:false,calls:[],toasts:[]});
  const node=document.createElement('div');document.body.append(node);const view=createRoot(node);
  const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  await flush(()=>view.render(React.createElement(Component)));
  await flush(()=>button('New').click());
  if(platform==='web')await flush(()=>{store.getState().setNewCode('cohost15');store.getState().setDiscountValue('15');});
  else for(const [placeholder,value] of [['CODE (e.g. EARLYBIRD)','cohost15'],['e.g. 20','15']]){
   const field=[...node.querySelectorAll('input')].find(x=>x.placeholder===placeholder);
   await flush(()=>{field.value=value;field.dispatchEvent(new window.Event('input',{bubbles:true}));});
  }
  await flush(()=>button(platform==='web'?'Create':'Create Promo Code').click());
  assert.equal(state.calls.length,0,'fresh role denial prevents mutation');
  assert.equal(state.toasts.at(-1)[0],'error');
  // Logout while the form is mounted hides both form and cached list.
  state.authenticated=false;
  await flush(()=>view.render(React.createElement(Component)));
  assert.equal(node.querySelector('input'),null);
  assert.equal(button('New'),undefined);
  await flush(()=>view.unmount());node.remove();count+=2;
 }
 console.log(`Passed ${count} mounted promo create/error cases across web and native.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
