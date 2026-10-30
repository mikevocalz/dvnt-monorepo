#!/usr/bin/env node
// Mount both production comp forms with real stores, React Query and API wrapper.
// Only auth, network, native host views and outbound share/SMS are offline fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const nodePaths = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
const resolve = (name) => require.resolve(name, { paths: [ROOT, ...nodePaths] });
const fixtures = {
  "comp-fixture": `export const state={calls:[],toasts:[],defer:false,release:null,fail:false,closes:0,links:[],result:null};`,
  "@dvnt/app/lib/supabase/client": `import {state} from 'comp-fixture';export const supabase={functions:{invoke:async(name,input)=>{state.calls.push({name,...input});if(state.defer)await new Promise(resolve=>{state.release=resolve;});return state.fail?{error:{message:'Connection interrupted'}}:{data:{ok:true,data:state.result??{issued:input.body.quantity,skipped:[],claim_links:state.links}}};}}};`,
  "@dvnt/app/lib/auth/identity": `export const requireBetterAuthToken=async()=> 'fixture-auth';export const updateUserRowCache=()=>{};export const clearUserRowCache=()=>{};`,
  "@dvnt/app/lib/api/tickets": `export const ticketsApi={getTicketTypes:async()=>[{id:'tier1',name:'GA',is_active:true,quantity_total:100,quantity_sold:0}]};`,
  "@dvnt/app/lib/api/search": `export const searchApi={searchUsers:async()=>({docs:[]})};`,
  "@dvnt/app/lib/stores/ui-store": `import {state} from 'comp-fixture';export const useUIStore=selector=>selector({showToast:(...a)=>state.toasts.push(a)});`,
  "@dvnt/app/lib/tickets/pick-contact-phone": `export const canPickContact=false;export const pickContactPhone=async()=>null;`,
  "@dvnt/app/lib/tickets/send-comp-claim": `export const canTextAll=false;export const textClaimLink=async()=> 'opened';export const shareClaimLink=async()=> 'shared';`,
  "@dvnt/app/lib/deep-linking/share-link": `export const copyShareUrl=()=>{};`,
  "@dvnt/app/components/bottom-sheet.web": `export const BottomSheet=({open,onClose,title,children,footer})=>open?<div role="dialog" aria-label={title}><button onClick={onClose}>Close sheet</button>{children}{footer}</div>:null;`,
  "react-native": `export const View=({children})=><div>{children}</div>;export const ScrollView=View;export const Text=({children})=><span>{children}</span>;export const TextInput=({value,onChangeText,placeholder,editable})=><textarea value={value} onInput={e=>onChangeText(e.target.value)} placeholder={placeholder} disabled={editable===false}/>;export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityState})=><button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel} aria-pressed={accessibilityState?.selected}>{children}</button>;export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;export const ActivityIndicator=()=> <span role="progressbar"/>;export const StyleSheet={create:x=>x,hairlineWidth:1};export const Alert={alert(){}};export const Platform={OS:'ios'};`,
  "react-native-keyboard-controller": `export {View as KeyboardAvoidingView} from 'react-native';`,
};
fixtures['lucide-react']=fixtures['lucide-react-native']=['Gift','Check','AlertCircle','Mail','MessageSquare','Share2','Copy','X','CheckCircle2','Circle','UserPlus'].map(name=>`export const ${name}=()=>null;`).join('');
const source = `export {default as React,act} from 'react';export {createRoot} from 'react-dom/client';export {QueryClient,QueryClientProvider} from '@tanstack/react-query';export {CompTicketsModal as Web} from './packages/app/features/events/ui/comp-tickets-modal.web';export {CompTicketsModal as Native} from './packages/app/features/events/ui/comp-tickets-modal';export {useAttendeesStore as store} from './packages/app/lib/stores/attendees-store';export {useCompClaimSendStore as claimStore} from './packages/app/lib/stores/comp-claim-send-store';export {bulkCompTickets} from './packages/app/lib/api/privileged';export {state} from 'comp-fixture';`;
(async()=>{
  const {Window}=await import(resolve('happy-dom'));
  const window=new Window({url:'https://comp-fixture.invalid'});
  Object.assign(global,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comp-quantity-'));
  let passed=0;
  try {
    await require(resolve('esbuild')).build({stdin:{contents:source,resolveDir:ROOT,loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',outfile:path.join(dir,'test.cjs'),nodePaths,tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},alias:Object.fromEntries(['react','react-dom','zustand','@tanstack/react-query'].map(name=>[name,path.dirname(resolve(name+'/package.json'))])),plugins:[{name:'offline-comp',setup(b){
      b.onResolve({filter:/.*/},a=>{
        if(Object.hasOwn(fixtures,a.path))return {path:a.path,namespace:'fixture'};
        if(a.path.startsWith('.')){const key='@dvnt/app/'+path.relative(path.join(ROOT,'packages/app'),path.resolve(a.resolveDir,a.path)).replace(/\\/g,'/');if(Object.hasOwn(fixtures,key))return {path:key,namespace:'fixture'};}
        if(a.path.startsWith('@dvnt/app/')){const stem=path.join(ROOT,'packages/app',a.path.slice(10));for(const suffix of ['.ts','.tsx','/index.ts'])if(fs.existsSync(stem+suffix))return {path:stem+suffix};}
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:ROOT}));
    }}]});
    const f=require(path.join(dir,'test.cjs'));
    const flush=async(run)=>{await f.act(async()=>{if(run)await run();await new Promise(r=>setTimeout(r,30));});};
    const byLabel=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);
    const byText=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
    const click=async b=>{assert.ok(b,'button exists');assert.equal(b.disabled,false);await flush(()=>b.click());};
    for (const [platform,Component] of [['web',f.Web],['native',f.Native]]) {
      const client=new f.QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});
      const host=document.createElement('div');document.body.append(host);const root=f.createRoot(host);
      let visible=true;
      const render=()=>root.render(f.React.createElement(f.QueryClientProvider,{client},f.React.createElement(Component,{visible,eventId:1,eventTitle:'Fixture event',onClose:()=>{f.state.closes++;f.store.getState().closeComp();visible=false;render();}})));
      await flush(()=>{f.store.getState().openComp();render();});await flush();
      assert.equal(byLabel('1 ticket per recipient').getAttribute('aria-pressed'),'true');
      assert.equal(byLabel('4 tickets per recipient'),undefined);
      await click(byLabel('3 tickets per recipient'));
      if(platform==='web')await flush(()=>f.store.getState().setCompRecipients('@nova'));
      else await flush(()=>{const input=document.querySelector('textarea');input.value='@nova';input.dispatchEvent(new window.Event('input',{bubbles:true}));});
      assert.match(document.body.textContent,/Existing tickets count toward this total/);
      f.state.calls=[];f.state.links=[];f.state.defer=true;
      await click(byText('Comp up to 3 tickets'));
      assert.equal(f.state.calls.length,1);
      assert.deepEqual(f.state.calls[0],{name:'bulk-comp-tickets',body:{event_id:1,tier_id:'tier1',recipients:['@nova'],note:undefined,quantity:3},headers:{Authorization:'Bearer fixture-auth'}});
      assert.equal(byText(platform==='web'?'Comping…':'')?.disabled ?? true,true);
      // Quantity selection is immutable while its issuance request is pending.
      assert.equal(byLabel('2 tickets per recipient').matches(':disabled'),true);
      f.state.defer=false;await flush(()=>f.state.release());await flush();
      assert.match(document.body.textContent,platform==='web'?/3Tickets issued/:/3 issued to accounts/);
      await click(byText('Done'));assert.equal(document.querySelector('[role="dialog"]'),null);
      await flush(()=>{visible=true;f.store.getState().openComp();render();});await flush();
      assert.equal(byLabel('1 ticket per recipient').getAttribute('aria-pressed'),'true');
      await click(byLabel('2 tickets per recipient'));
      if(platform==='web')await flush(()=>f.store.getState().setCompRecipients('@nova'));
      else await flush(()=>{const input=document.querySelector('textarea');input.value='@nova';input.dispatchEvent(new window.Event('input',{bubbles:true}));});
      f.state.fail=true;await click(byText('Comp up to 2 tickets'));await flush();
      assert.match(f.state.toasts.at(-1)[2],/Connection interrupted/);
      assert.equal(byLabel('2 tickets per recipient').getAttribute('aria-pressed'),'true');
      f.state.fail=false;await click(byText('Comp up to 2 tickets'));await flush();
      assert.deepEqual(f.state.calls.slice(-2).map(call=>call.body.quantity),[2,2]);
      await click(byText('Done'));
      await flush(()=>{visible=true;f.store.getState().openComp();render();});await flush();
      await click(byLabel('3 tickets per recipient'));
      const phone='+14155550134';
      if(platform==='web')await flush(()=>f.store.getState().setCompRecipients(phone));
      else await flush(()=>{const input=document.querySelector('textarea');input.value=phone;input.dispatchEvent(new window.Event('input',{bubbles:true}));});
      f.state.links=[1,2,3].map(n=>({recipient:phone,phone,ticket_id:'ticket'+n,url:'https://fixture.invalid/claim/'+n,expires_at:'2099-01-01',reissued:false}));
      await click(byText('Comp up to 3 tickets'));await flush();
      for (const n of [1,2,3]) assert.ok(byLabel(`Text link to ${phone} · Ticket ${n} of 3`));
      await click(byLabel(`Text link to ${phone} · Ticket 2 of 3`));
      assert.deepEqual(f.claimStore.getState().statuses,{ticket2:'opened'});
      await click(byText('Done'));
      for (const [name,result,accepted,failed] of [
        ['member grouped', {issued:3,skipped:[],delivery:[{recipient:'@nova',status:'delivered'}]},1,0],
        ['mixed partial', {issued:3,guest_issued:2,skipped:[],delivery:[{recipient:'@nova',status:'failed',error:'No email address on account'},{recipient:'guest@example.invalid',status:'delivered'}]},1,1],
        ['phone only', {issued:0,phone_guest_issued:3,skipped:[]},0,0],
        ['queued missing address', {issued:6,skipped:[],delivery:[{recipient:'@nova',status:'queued'},{recipient:'@missing',status:'not_available',error:'No email address on account'}]},0,1],
        ['legacy unknown', {issued:3,skipped:[]},0,0],
      ]) {
        f.state.result=result;f.state.links=[];
        await flush(()=>{visible=true;f.store.getState().openComp();render();});await flush();
        if(platform==='web')await flush(()=>f.store.getState().setCompRecipients('@nova'));
        else await flush(()=>{const input=document.querySelector('textarea');input.value='@nova';input.dispatchEvent(new window.Event('input',{bubbles:true}));});
        await click(byText('Comp up to 1 ticket'));await flush();
        const text=document.body.textContent;
        assert.match(text,/Ticket emails sent/,platform+': '+name);
        assert.match(text,new RegExp((name==='legacy unknown'?'—':accepted)+' accepted for sending'));
        assert.match(text,/Email counts are messages, not ticket quantities/);
        assert.match(text,/Inbox delivery is not guaranteed/);
        if(failed){assert.match(text,/No email address on account/);assert.match(text,/Do not comp again to retry email/);assert.match(text,/tickets stay valid/);}
        if(name==='phone only')assert.match(text,/follows account claim/);
        if(name==='queued missing address')assert.match(text,/1 queued/);
        if(name==='legacy unknown')assert.match(text,/Email status is unavailable/);
        assert.doesNotMatch(text,/comp it again|Every guest email went out|email didn.t arrive/);
        await click(byText('Done'));passed++;console.log('PASS '+platform+': '+name+' email result');
      }
      f.state.result=null;
      await flush(()=>root.unmount());client.clear();host.remove();passed++;console.log('PASS '+platform+': quantity, payload, pending guard, reopen default, failed retry, independent phone links');
    }
    f.state.calls=[];await f.bulkCompTickets(1,'tier1',['@nova']);assert.equal(f.state.calls[0].body.quantity,1);passed++;console.log('PASS legacy API callers default to one ticket');
    console.log(`${passed} mounted UI/API checks passed`);
  } finally {fs.rmSync(dir,{recursive:true,force:true});await window.happyDOM.abort();}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
