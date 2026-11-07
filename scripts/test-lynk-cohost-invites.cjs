#!/usr/bin/env node
/** Actual invite hooks/cards with React Query; server, auth and native UI boundaries are fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window({ url: 'https://fixture.invalid' });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-invites-'));
  const mock = path.join(temp, 'boundary.tsx');
  fs.writeFileSync(mock, `
    import React,{useSyncExternalStore} from 'react';
    export const fixture:any={account:{user:{id:'1',authId:'auth-a'},isAuthenticated:true},epoch:'0',invites:[],reads:0,calls:[],pushes:[],feedback:[],toasts:[],dismissed:[],error:false};
    const listeners=new Set<any>();
    export function setAccount(id:string|null){fixture.account={user:id?{id,authId:'auth-'+id}:null,isAuthenticated:!!id};fixture.epoch=String(+fixture.epoch+1);listeners.forEach(fn=>fn());}
    export const useAuthStore:any=(select:any)=>select(useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>fixture.account));
    useAuthStore.getState=()=>fixture.account;
    export const getCurrentUserAuthId=async()=>{fixture.identityReads=(fixture.identityReads??0)+1;return fixture.identityError?null:fixture.account.user?.authId??null;};
    export const getBridgeRequestEpoch=()=>fixture.epoch;
    export const useRouter=()=>router;
    const router={push:(url:string)=>fixture.pushes.push(url)};
    const showToast=(...args:any[])=>fixture.feedback.push(args);
    export const useUIStore=(select:any)=>select({showToast});
    export const lynkCohostInvites={listPending:async()=>{fixture.reads++;if(fixture.error)throw Error('offline');return [...fixture.invites];},invite:async()=>{},accept:(id:number)=>respond(id,'accept'),decline:(id:number)=>respond(id,'decline')};
    function respond(id:number,action:string){return new Promise((resolve,reject)=>fixture.calls.push({id,action,resolve:(result:any)=>{fixture.invites=fixture.invites.filter((i:any)=>i.id!==id);resolve(result);},reject}));}
    export const toast:any=(title:string,options:any)=>{const id=fixture.toasts.length+1;fixture.toasts.push({id,title,options});return id;};
    toast.dismiss=(id:any)=>fixture.dismissed.push(id);
    export const Radio=()=>null;
    export const View=({children,accessibilityLabel,...props}:any)=><div aria-label={accessibilityLabel}>{children}</div>;
    export const Text=({children}:any)=><span>{children}</span>;
    export const Pressable=({children,onPress,disabled,accessibilityLabel}:any)=><button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>{children}</button>;
  `);
  const aliases = { '@dvnt/app': path.join(ROOT,'packages/app'), react:path.dirname(require.resolve('react/package.json')), 'react-dom':path.dirname(require.resolve('react-dom/package.json')), '@tanstack/react-query':path.dirname(require.resolve('@tanstack/react-query/package.json')) };
  const boundary = new Set(['solito/navigation','sonner','lucide-react','lucide-react-native','react-native','@dvnt/app/lib/stores/auth-store','@dvnt/app/lib/stores/ui-store','@dvnt/app/lib/api/auth-helper','@dvnt/app/lib/supabase/client','@dvnt/app/features/sneaky-lynk/api/cohost-invites']);
  try {
    await require('esbuild').build({
      stdin:{resolveDir:ROOT,loader:'tsx',contents:`
        import React,{act} from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
        import{PendingCohostInvites as Web,CohostInviteToast}from'./packages/app/features/sneaky-lynk/ui/web/CohostInvites';
        import{PendingCohostInvites as Native}from'./packages/app/features/sneaky-lynk/ui/PendingCohostInvites';
        export{fixture,setAccount}from${JSON.stringify(mock)};
        export{act};export const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false,gcTime:0}}});
        export function mount(node:any){const root=createRoot(node);return{render:(native=false,toast=false)=>root.render(<QueryClientProvider client={client}>{toast?<CohostInviteToast/>:null}{native?<Native/>:<Web/>}</QueryClientProvider>),unmount:()=>root.unmount()};}
      `},bundle:true,platform:'node',format:'cjs',jsx:'automatic',nodePaths:[path.join(ROOT,'node_modules')],alias:aliases,
      plugins:[{name:'boundaries',setup(build){build.onResolve({filter:/.*/},args=>boundary.has(args.path)?{path:mock}:undefined);}}],outfile:path.join(temp,'fixture.cjs'),logLevel:'silent'
    });
    const {fixture:f,setAccount,client,act,mount}=require(path.join(temp,'fixture.cjs'));
    const node=document.createElement('div');document.body.append(node);let renderer=mount(node);
    const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});
    const render=async(native=false,toast=false)=>{await act(async()=>renderer.render(native,toast));await settle();await settle();};
    const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    const click=async b=>{assert.ok(b);await act(async()=>b.click());await settle();};
    const invite={id:5,roomId:9,roomUuid:'room-a',roomTitle:'Late night conversation',inviterId:'host',status:'pending',createdAt:'2026-11-07T12:00:00Z'};
    f.invites=[invite];
    await render(false,true);
    assert.match(node.textContent,/Your existing room identity stays the same\. New members use their profile/);
    assert.equal(f.toasts.length,1);
    await act(async()=>f.toasts[0].options.cancel.onClick());assert.equal(f.calls.length,0,'Not now never declines');
    const acceptButton=button('Accept & review');
    await act(async()=>{acceptButton.click();acceptButton.click();});await settle();
    assert.equal(f.calls.length,1,'same-card rapid repeat is ignored without replacing the original mutation callbacks');assert.equal(f.calls[0].action,'accept');assert.equal(f.pushes.length,0,'no optimistic admission');
    assert.equal(button('Decline').disabled,true,'all response controls lock while accepting');
    await act(async()=>f.toasts[0].options.action.onClick());await settle();
    assert.equal(f.calls.length,1,'toast and card share synchronous account lock');
    await act(async()=>f.calls[0].resolve({status:'accepted',roomId:'room-a',role:'co-host'}));await settle();await settle();
    assert.deepEqual(f.pushes,['/feed/sneaky-lynk/room/room-a']);assert.equal(node.querySelector('article'),null,'confirmed invite disappears');
    assert.ok(f.dismissed.includes(1),'resolved invite toast dismissed');
    console.log('PASS web accept: explicit consent, duplicate lock, server confirmation, standard prejoin, stale toast cleanup');

    await act(async()=>renderer.unmount());client.clear();renderer=mount(node);f.invites=[{...invite,id:6}];f.error=true;
    await render();assert.match(node.textContent,/couldn't refresh/);assert.ok(button('Retry invitations'));
    f.error=false;await click(button('Retry invitations'));await settle();assert.ok(button('Accept & review'));
    console.log('PASS failed read remains distinguishable from empty; explicit retry recovers');
    await act(async()=>renderer.unmount());client.clear();renderer=mount(node);f.identityError=true;
    const readsBeforeIdentity=f.reads;await render();
    assert.match(node.textContent,/couldn't refresh/);assert.equal(f.reads,readsBeforeIdentity,'failed identity never calls invite query with null account');
    f.identityError=false;await click(button('Retry invitations'));await settle();await settle();
    assert.ok(button('Accept & review'),'retry resolves account before loading invitations');
    console.log('PASS cold identity lookup failure shows recovery and retry loads the correct account');


    await act(async()=>renderer.unmount());client.clear();renderer=mount(node);f.invites=[{...invite,id:7}];
    await render(true);assert.ok(node.querySelector('[aria-label="Accept co-host invitation to Late night conversation"]'));
    await click(button('Decline'));const decline=f.calls.at(-1);assert.equal(decline.action,'decline');
    await act(async()=>decline.reject(Error('offline')));await settle();
    assert.ok(button('Decline'));assert.equal(f.pushes.length,1);
    await click(button('Accept & review'));const late=f.calls.at(-1);
    await act(async()=>setAccount('b'));await settle();
    const priorFeedback=f.feedback.length;
    await act(async()=>late.resolve({status:'accepted',roomId:'old-account-room',role:'co-host'}));await settle();
    assert.equal(f.pushes.length,1,'old-account acceptance cannot navigate new account');assert.equal(f.feedback.length,priorFeedback,'old-account response produces no toast');
    console.log('PASS native consent/failure/retry and account-switch late-response isolation');
    await act(async()=>renderer.unmount());client.clear();renderer=mount(node);
    f.invites=[{...invite,id:8}];await render(true);
    await click(button('Accept & review'));const roundtrip=f.calls.at(-1);
    const beforeRoundtripFeedback=f.feedback.length;
    await act(async()=>{setAccount('c');setAccount('b');roundtrip.resolve({status:'accepted',roomId:'stale-roundtrip-room',role:'co-host'});});await settle();
    assert.equal(f.pushes.length,1,'A/B/A epoch invalidates late navigation even when React batches account updates');
    assert.equal(f.feedback.length,beforeRoundtripFeedback,'A/B/A epoch invalidates late feedback');
    console.log('PASS batched A/B/A epoch discards an already-dispatched acceptance result');
    // Keep the actual queryFn built for B, then execute it under stable C.
    // Query retries retain the original options even after their observer moved.
    const bKey=['my-auth-id','b:auth-b'];
    const bOptions=client.getQueryCache().find({queryKey:bKey,exact:true}).options;
    await act(async()=>setAccount('c'));await settle();await settle();
    const beforeDelayedIdentity=f.identityReads;
    await act(async()=>{
      await assert.rejects(client.fetchQuery({...bOptions,staleTime:0,retry:1,retryDelay:1}),/account changed/);
    });
    assert.equal(f.identityReads,beforeDelayedIdentity,'both delayed execution and retry reject before reading C into B cache');
    assert.notEqual(client.getQueryData(bKey),'auth-c');
    assert.equal(client.getQueryData(['my-auth-id','c:auth-c']),'auth-c','current account query still works');
    console.log('PASS delayed query execution and retry remain bound to the rendered account key');

    await act(async()=>renderer.unmount());client.clear();
    console.log('PASS production web/native invite components and shared query/mutation hooks');
  } finally { fs.rmSync(temp,{recursive:true,force:true});window.happyDOM.abort(); }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
