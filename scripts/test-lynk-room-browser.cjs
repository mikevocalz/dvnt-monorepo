// Real React chat + participant hooks/panel. Only server/auth boundaries are fixtures.
// No accounts, live rooms, cameras, tokens, messages or payments are touched.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
let chromium;
if (!process.argv.includes('--dom')) ({ chromium } = require('@playwright/test'));
const ROOT = path.resolve(__dirname, '..');
const boundaries = {
  '@dvnt/app/lib/user-label': `export {getSneakyUserLabel} from '${path.join(ROOT,'packages/app/lib/user-label.ts')}';`,
  'lynk-fixture': `
    const subscriptions=[],requests=[]; let nextId=100;
    export const subscribe=(kind,roomId,options)=>{const item={kind,roomId,options,active:true};subscriptions.push(item);return()=>{item.active=false}};
    export const post=params=>new Promise((resolve,reject)=>requests.push({params,resolve,reject}));
    window.fixture={subscriptions,requests,send:(index,rows)=>subscriptions[index].options.onSync(rows),fail:index=>subscriptions[index].options.onError(new Error('offline'))};
  `,
  'chat-api-fixture': `import {subscribe,post} from 'lynk-fixture';export const subscribeToRoomComments=(roomId,onNew,options)=>subscribe('chat',roomId,options);export const postRoomComment=post;`,
  'video-api-fixture': `import {subscribe} from 'lynk-fixture';export const videoApi={subscribeToMembers:(roomId,onChange,options)=>subscribe('members',roomId,options)};`,
};
(async()=>{
const bundle=await esbuild.build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`
 import React,{useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
 import {useRoomChat} from './packages/app/features/sneaky-lynk/hooks/useRoomChat';
 import {useRoomMembers} from './packages/app/features/sneaky-lynk/hooks/useRoomMembers';
 import {useRoomEntryScope} from './packages/app/features/sneaky-lynk/hooks/useRoomEntryScope';
 import {ChatPanel} from './packages/app/features/sneaky-lynk/ui/web/room-panels';
 import {peerIdForMember} from './packages/app/features/video/lynk-participants';
 import 'lynk-fixture';
 const setters={}; const snapshots={};
 const entryJoins=[],entryCallbacks={};
 function EntryChild({scope}){useEffect(()=>{entryJoins.push(scope)},[scope]);return null;}
 function EntryFixture(){const [scope,setScope]=useState('account-a:room-a');const [phase,setPhase]=useState('connected');const entry=useRoomEntryScope(scope);
  window.fixture.entry={joins:entryJoins,callbacks:entryCallbacks,switch:next=>{setPhase('connected');setScope(next)},join:()=>setPhase('connected')};entryCallbacks[scope]=entry.isCurrent;
  useEffect(()=>{setPhase('prejoin');entry.initialize()},[scope]);
  return entry.ready&&phase==='connected'?<EntryChild key={scope} scope={scope}/>:null;
 }
 function Client({client}){const [state,set]=useState({roomId:'room-a',userId:client,enabled:false});setters[client]=set;
  const currentUser={id:state.userId,username:state.userId,displayName:state.userId,avatar:'',isVerified:true};
  const chat=useRoomChat({roomId:state.roomId,currentUser,enabled:state.enabled});
  const roster=useRoomMembers(state.roomId,state.userId,state.enabled);snapshots[client]={chat,roster};
  return <section data-client={client}><output data-members>{roster.members.map(m=>m.userId+':'+peerIdForMember(m.userId,m.anonLabel)).join(',')}</output><ChatPanel key={state.userId+state.roomId} open onClose={()=>{}} comments={chat.comments} onSend={chat.send} currentUserId={state.userId} error={chat.error} loading={chat.loading} disabled={!state.enabled}/></section>;
 }
 window.fixture.update=(client,patch)=>setters[client](s=>({...s,...patch}));window.fixture.snapshots=snapshots;
 createRoot(document.getElementById('root')).render(<><Client client="alice"/><Client client="bob"/><EntryFixture/></>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'lynk-boundaries',setup(build){build.onResolve({filter:/.*/},args=>{
 if(Object.hasOwn(boundaries,args.path))return {path:args.path,namespace:'fixture'};
 if(args.path==='../api/comments'&&args.importer.endsWith('useRoomChat.ts'))return {path:'chat-api-fixture',namespace:'fixture'};
 if(args.path==='../../video/api'&&args.importer.endsWith('useRoomMembers.ts'))return {path:'video-api-fixture',namespace:'fixture'};
 if(args.path==='lucide-react')return {path:'icons',namespace:'fixture'};
 });build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:ROOT,contents:args.path==='icons'?['Ban','Check','Crown','Hand','MessageCircle','Mic','MicOff','Send','UserMinus','Users','UserX','X'].map(n=>'export const '+n+'=()=>null;').join('\n'):boundaries[args.path]}));}}]});
if (process.argv.includes('--dom')) {
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost',runScripts:'outside-only',pretendToBeVisual:true});
 const {window}=dom;const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.eval(bundle.outputFiles[0].text);
 const tick=()=>new Promise(r=>setTimeout(r,25));await tick();const f=window.fixture;
 const update=async(client,patch)=>{f.update(client,patch);await tick()};
 assert.equal(f.entry.joins.length,0,'stale connected phase cannot join before entry reset');
 f.entry.join();await tick();assert.equal(f.entry.joins.join(','),'account-a:room-a');
 f.entry.switch('account-b:room-a');await tick();assert.equal(f.entry.joins.length,1,'account switch must not auto-join');assert.equal(f.entry.callbacks['account-a:room-a'](),false,'old verification callback is inactive');
 f.entry.join();await tick();assert.equal(f.entry.joins.join(','),'account-a:room-a,account-b:room-a');
 f.entry.switch('account-b:room-b');await tick();assert.equal(f.entry.joins.length,2,'room switch must not auto-join');
 const comment=(id,authorId,body)=>({id,roomId:'room-a',authorId,body,parentId:null,rootId:null,depth:0,mentions:[],createdAt:new Date(1700000000000+id).toISOString(),author:{username:authorId,displayName:authorId,avatar:'',isVerified:true}});
 const members=[{userId:'alice',status:'active',role:'host',handRaised:false},{userId:'bob',status:'active',role:'participant',handRaised:false},{userId:'member:9',status:'active',role:'participant',isAnonymous:true,anonLabel:'Anon 7',handRaised:false}];
 assert.equal(f.subscriptions.length,0,'no pre-admission reads');await update('alice',{enabled:true});await update('bob',{enabled:true});assert.equal(f.subscriptions.length,4);
 const ac=0,am=1,bc=2,bm=3;for(const i of [am,bm])f.send(i,members);for(const i of [ac,bc])f.send(i,[comment(1,'bob','Already here')]);await tick();
 const alice=window.document.querySelector('[data-client=alice]');
 assert.match(alice.querySelector('[data-members]').textContent,/member:9:anon-7/);
 const submit=async body=>{const input=alice.querySelector('input');input.value=body;alice.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();return input};
 const input=await submit('Hello Bob');assert.equal(f.requests.length,1);const saved=comment(101,'alice','Hello Bob');for(const i of [ac,bc])f.send(i,[comment(1,'bob','Already here'),saved]);f.requests[0].resolve(saved);await tick();assert.equal(input.value,'');assert.equal(f.snapshots.alice.chat.comments.filter(c=>c.id===101).length,1);assert.equal(f.snapshots.bob.chat.comments.filter(c=>c.id===101).length,1);
 f.send(am,members.filter(m=>m.userId!=='bob'));await tick();assert.doesNotMatch(alice.querySelector('[data-members]').textContent,/bob/);f.send(am,members);await tick();assert.match(alice.querySelector('[data-members]').textContent,/bob/);
 await submit('Retry me');f.requests[1].resolve(null);await tick();assert.equal(input.value,'Retry me');assert.match(alice.querySelector('[role=alert]').textContent,/wasn't sent/);
 await submit('Retry me');await update('alice',{userId:'charlie'});assert.equal(alice.querySelector('[data-members]').textContent,'');assert.doesNotMatch(alice.textContent,/Already here/);
 f.send(ac,[comment(900,'alice','STALE PRIVATE MESSAGE')]);f.send(am,members);f.requests[2].resolve(comment(102,'alice','Retry me'));await tick();assert.doesNotMatch(alice.textContent,/STALE PRIVATE MESSAGE|Retry me/);assert.equal(alice.querySelector('[data-members]').textContent,'');assert.equal(f.subscriptions.filter(s=>s.active).length,4);
 await update('alice',{enabled:false});assert.equal(f.subscriptions.filter(s=>s.active).length,2);assert.deepEqual(errors,[]);dom.window.close();console.log('PASS React DOM fixture: scoped entry/account/room gate, two clients, delayed admission, anonymous peer mapping, optimistic echo/HTTP races, join/leave/reconnect snapshots, failed-send draft, account switch, stale callbacks, cleanup');return;
}
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:'<!doctype html><div id="root"></div><script src="/bundle.js"></script>')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.fixture?.snapshots.alice);
 const update=async(client,patch)=>{await page.evaluate(({client,patch})=>window.fixture.update(client,patch),{client,patch});await page.waitForTimeout(20)};
 const subs=()=>page.evaluate(()=>window.fixture.subscriptions.map((s,i)=>({i,kind:s.kind,roomId:s.roomId,active:s.active})));
 const deliver=(index,rows)=>page.evaluate(({index,rows})=>window.fixture.send(index,rows),{index,rows});
 const comment=(id,authorId,body)=>({id,roomId:'room-a',authorId,body,parentId:null,rootId:null,depth:0,mentions:[],createdAt:new Date(1700000000000+id).toISOString(),author:{username:authorId,displayName:authorId,avatar:'',isVerified:true}});
 assert.equal((await subs()).length,0,'no data before admission');
 await update('alice',{enabled:true});await update('bob',{enabled:true});let active=await subs();assert.equal(active.length,4);
 const ac=active[0].i,am=active[1].i,bc=active[2].i,bm=active[3].i;
 const members=[{userId:'alice',status:'active',role:'host',handRaised:false},{userId:'bob',status:'active',role:'participant',handRaised:false},{userId:'member:9',status:'active',role:'participant',isAnonymous:true,anonLabel:'Anon 7',handRaised:false}];
 for(const index of [am,bm])await deliver(index,members);
 for(const client of ['alice','bob'])assert.match(await page.locator('[data-client='+client+'] [data-members]').textContent(),/member:9:anon-7/,'existing anonymous publisher mapping preserved');
 for(const index of [ac,bc])await deliver(index,[comment(1,'bob','Already here')]);
 const alice=page.locator('[data-client=alice]');const input=alice.getByRole('textbox',{name:'Message'});await input.fill('Hello Bob');await alice.getByRole('button',{name:'Send message'}).click();await page.waitForFunction(()=>window.fixture.requests.length===1);
 const saved=comment(101,'alice','Hello Bob');await deliver(ac,[comment(1,'bob','Already here'),saved]);await deliver(bc,[comment(1,'bob','Already here'),saved]);await page.evaluate(saved=>window.fixture.requests[0].resolve(saved),saved);await page.waitForFunction(()=>window.fixture.snapshots.alice.chat.comments.filter(c=>c.id===101).length===1);assert.equal(await input.inputValue(),'');assert.equal(await alice.getByText('Hello Bob',{exact:true}).count(),1);
 // Leave/join/reconnect authoritative snapshots preserve no departed member.
 await deliver(am,members.filter(m=>m.userId!=='bob'));assert.doesNotMatch(await alice.locator('[data-members]').textContent(),/bob/);
 await deliver(am,members);assert.match(await alice.locator('[data-members]').textContent(),/bob/);
 // Failed send keeps editable text and exposes retry action via the same composer.
 await input.fill('Retry me');await alice.getByRole('button',{name:'Send message'}).click();await page.waitForFunction(()=>window.fixture.requests.length===2);await page.evaluate(()=>window.fixture.requests[1].resolve(null));await alice.getByRole('alert').waitFor();assert.equal(await input.inputValue(),'Retry me');
 // Old account's HTTP result and realtime callbacks cannot populate a new account.
 await alice.getByRole('button',{name:'Send message'}).click();await page.waitForFunction(()=>window.fixture.requests.length===3);await update('alice',{userId:'charlie'});assert.equal(await alice.getByText('Already here',{exact:true}).count(),0);assert.equal(await alice.locator('[data-members]').textContent(),'');
 await deliver(ac,[comment(900,'alice','STALE PRIVATE MESSAGE')]);await deliver(am,members);await page.evaluate(saved=>window.fixture.requests[2].resolve(saved),comment(102,'alice','Retry me'));await page.waitForTimeout(25);assert.equal(await alice.getByText('STALE PRIVATE MESSAGE',{exact:true}).count(),0);assert.equal(await alice.getByText('Retry me',{exact:true}).count(),0);assert.equal(await alice.locator('[data-members]').textContent(),'');
 active=await subs();assert.equal(active.filter(s=>s.active).length,4,'old account subscriptions disposed');await update('alice',{enabled:false});assert.equal((await subs()).filter(s=>s.active).length,2,'leaving cancels both channels');assert.deepEqual(errors,[]);console.log('PASS real chat/participants: two users, delayed admission, existing anonymous peers, echo/HTTP race, join/leave/reconnect snapshots, failed-send draft, account switch, stale callbacks, cleanup');
}finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
