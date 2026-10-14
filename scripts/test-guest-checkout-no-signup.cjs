// Actual guest sheet and Zustand store in ReactDOM; API/quote/UI boundaries are fixtures.
const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),cache=new Map();
let root,dom,calls,requireNames='off';
const mocks={
 'react':React,'react/jsx-runtime':require('react/jsx-runtime'),
 'lucide-react':{Minus:()=>null,Plus:()=>null,Lock:()=>null,CheckCircle2:()=>null},
 './promoter-ref-store':{getPendingPromoterRef:()=>null},
 '@dvnt/app/lib/hooks/use-events':{useEvent:()=>({data:null})},
 '@dvnt/app/lib/events/event-time':{formatEventWhen:()=>''},
 './use-guest-checkout-quote.web':{useGuestCheckoutQuote:()=>{}},
 './guest-checkout-code.web':{GuestCheckoutCode:()=>null},
 '@dvnt/app/components/bottom-sheet.web':{BottomSheet:({open,children})=>open?React.createElement('section',null,children):null},
 '@dvnt/app/lib/supabase/client':{supabase:{from:()=>({select:()=>({eq:()=>({single:async()=>({data:{attendee_name_requirement:requireNames}})})})}),functions:{invoke:async(name,args)=>{calls.push(args.body);return{data:{ok:true,free:true,count:1},error:null};}}}},
};
function load(file){
 if(!path.extname(file))file+='.ts';if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:(name)=>{
  if(Object.hasOwn(mocks,name))return mocks[name];
  if(/checkout-profile/.test(name))throw Error('Guest sheet must not load account creation');
  if(name.startsWith('@dvnt/app/'))return load(path.join(ROOT,'packages/app',name.slice(10)));
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));
  return require(name);
 },console,crypto:require('node:crypto').webcrypto,Date,window:{}},{filename:file});return exports;
}
const store=load(path.join(ROOT,'packages/app/lib/stores/guest-checkout-store.ts')).useGuestCheckoutStore;
const {guestQuoteSelectionKey}=load(path.join(ROOT,'packages/app/lib/tickets/guest-checkout-quote.ts'));
const {GuestCheckoutSheet}=load(path.join(ROOT,'packages/app/features/events/guest-checkout-sheet.web.tsx'));
beforeEach(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 calls=[];requireNames='off';root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await React.act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;});
async function open(patch={},total=0){
 await React.act(async()=>{
  store.getState().openSheet({eventId:'42',eventTitle:'Fixture',tierId:'tier',tierName:'Admission',priceCents:total});
  store.getState().patch({email:'guest@example.test',...patch});
  const state=store.getState();state.patch({quote:{quote_key:'a'.repeat(64),total_cents:total},quoteSelectionKey:guestQuoteSelectionKey(state)});
  root.render(React.createElement(GuestCheckoutSheet));
 });
}
async function submit(){await React.act(async()=>[...document.querySelectorAll('button')].find(b=>/^(Get free tickets|Pay \$)/.test(b.textContent)).click());}
test('email-only free guest purchase does not collect or send signup fields',async()=>{
 await open();assert.equal(document.querySelectorAll('input').length,2);
 assert.match(document.body.textContent,/Name \(optional\)/);assert.doesNotMatch(document.body.textContent,/MOBILE NUMBER|set up your DVNT profile|USERNAME/);
 await submit();assert.equal(calls.length,1);assert.equal(calls[0].guest_email,'guest@example.test');assert.equal(calls[0].guest_name,'');
 for(const key of ['username','full_name','phone'])assert.equal(Object.hasOwn(calls[0],key),false);
 assert.match(document.body.textContent,/Creating a DVNT account is optional/);
});
test('paid guest request retains buyer name and quote without provisioning fields',async()=>{
 await open({name:' Guest Buyer '},2663);await submit();assert.equal(calls.length,1);assert.equal(calls[0].guest_name,'Guest Buyer');assert.equal(calls[0].expected_quote_key,'a'.repeat(64));
 for(const key of ['username','full_name','phone'])assert.equal(Object.hasOwn(calls[0],key),false);
});
test('invalid email still blocks submission',async()=>{await open({email:'bad'});await submit();assert.equal(calls.length,0);assert.match(document.body.textContent,/Enter a valid email/);});
test('event-required attendee names still block submission',async()=>{requireNames='required';await open();await submit();assert.equal(calls.length,0);assert.match(document.body.textContent,/Enter a name for each ticket/);});
test('reopening clears buyer details rather than reusing another purchase',async()=>{await open({name:'Previous Buyer'});await open();assert.equal(store.getState().name,'');});
