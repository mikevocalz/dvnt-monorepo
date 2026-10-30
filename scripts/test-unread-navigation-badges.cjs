#!/usr/bin/env node
/** Real React + TanStack Query + RN Web chrome, synthetic backend only. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const paths = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
const resolve = (name) => require.resolve(name, { paths: paths.length ? paths : undefined });
const { build } = require(resolve("esbuild"));
const { chromium } = require(resolve("playwright"));
const root = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unread-navigation-"));
const deps = Object.fromEntries(["react", "react-dom", "react-native-web", "lucide-react", "zustand", "@tanstack/react-query", "@tanstack/query-core"].map(name => [name, path.dirname(resolve(name + "/package.json"))]));
const mocks = {
  auth: `import {create} from 'zustand'; export const useAuthStore=create(()=>({user:{id:'101',username:'fixture'},isAuthenticated:true,authStatus:'authenticated'}));`,
  counts: `export const notificationsApi={getBadges:()=>globalThis.F.fetch('activity')}; export const messagesApi={getUnreadCounts:()=>globalThis.F.fetch('messages')};`,
  store: `export const useUnreadCountsStore={getState:()=>({messagesUnread:999,spamUnread:999,lastMessagesRefresh:Number.MAX_SAFE_INTEGER,setMessagesUnread(){},setSpamUnread(){}})};`,
  client: `export const supabase={channels:[],getChannels(){return this.channels},channel(topic){const c={topic:'realtime:'+topic,handlers:[],on(event,filter,callback){this.handlers.push({filter,callback});return this},subscribe(callback){this.status=callback;queueMicrotask(()=>callback?.('SUBSCRIBED'));return this}};this.channels.push(c);return c},removeChannel(c){this.channels=this.channels.filter(x=>x!==c);return Promise.resolve()}};`,
  route: `export const useRouter=()=>({push:(route)=>globalThis.F.routes.push(route)}); export const usePathname=()=>'/feed'; export function Link({children}){return children};`,
  logo: `export default function Logo(){return <span style={{color:'#fff',fontWeight:800,fontSize:24}}>DVNT</span>}`, 
  html: `import {View} from 'react-native'; export function Header(props){return <View {...props} role="banner"/>}`,
  colors: `export const useColorScheme=()=>({colors:{foreground:'#fff'}});`,
  scroll: `export const useFeedScrollStore=fn=>fn({triggerScrollToTop(){}});`,
  spicy: `export const supportsNativeTabsBottomAccessory=()=>false;export const SpicyToggleFAB=()=>null;`,
  safe: `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
  tabs: `export function NativeTabs({children}){return <div data-native-tabs="">{children}</div>};const Trigger=({name,children})=><div data-native-tab={name}>{children}</div>;Trigger.Icon=()=>null;Trigger.Label=({children})=><span>{children}</span>;Trigger.Badge=({hidden,children})=>hidden?null:<span data-native-badge="">{children}</span>;NativeTabs.Trigger=Trigger;NativeTabs.BottomAccessory=()=>null;`,
  empty: `export {};`,
};
const aliases = [
  [/\/(?:stores\/auth-store)(?:\.ts)?$/, "auth"],
  [/\/(?:api\/(?:messages-impl|notifications))(?:\.ts)?$/, "counts"],
  [/\/stores\/unread-counts-store(?:\.ts)?$/, "store"],
  [/\/supabase\/client(?:\.ts)?$/, "client"],
  [/^(?:solito\/navigation|expo-router)$/, "route"],
  [/^(?:.*\/)?logo$/, "logo"],
  [/\/components\/ui\/html$/, "html"],
  [/^@dvnt\/app\/lib\/hooks$/, "colors"],
  [/\/stores\/feed-scroll-store$/, "scroll"],
  [/\/components\/spicy-toggle-fab$/, "spicy"],
  [/^react-native-safe-area-context$/, "safe"],
  [/^expo-router\/unstable-native-tabs$/, "tabs"],
  [/\/perf\/tab-prefetches$/, "empty"],
];
const plugin = {name:"fixture-boundaries",setup(b){
  b.onResolve({filter:/.*/}, args=>{
    const match=aliases.find(([re])=>re.test(args.path) || (args.path.startsWith(".") && re.test(path.resolve(args.resolveDir,args.path))));
    if(match)return {path:match[1],namespace:"mock"};
    if(args.path==="react-native")return {path:require.resolve("react-native-web",{paths})};
    if(args.path==="lucide-react-native")return {path:require.resolve("lucide-react",{paths})};
    if(args.path==="@dvnt/app/components/center-button")return {path:path.join(root,"packages/app/components/center-button.web.tsx")};
  });
  b.onLoad({filter:/.*/,namespace:"mock"},args=>({contents:mocks[args.path],loader:"tsx",resolveDir:root}));
}};
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider,focusManager,onlineManager,timeoutManager} from '@tanstack/react-query';
import {AppShell} from './packages/app/components/app-shell.web';
import {TabHeaderRight} from './packages/app/components/tab-header';
import TabsLayout from './packages/app/features/routes/screens/(protected)/(tabs)/_layout';
import {useAuthStore} from './packages/app/lib/stores/auth-store';
import {supabase} from './packages/app/lib/supabase/client';
import {messageKeys} from './packages/app/lib/messages/query-keys';
import {notificationKeys} from './packages/app/lib/notifications/query-keys';
import {reconcileConversationReadState} from './packages/app/lib/messages/read-reconciliation';
import {observeUnreadChanges} from './packages/app/lib/hooks/use-unread-realtime';
timeoutManager.setTimeoutProvider({setTimeout:(cb,ms)=>setTimeout(cb,ms),clearTimeout:id=>clearTimeout(id),setInterval:(cb,ms)=>setInterval(cb,ms===30000?200:ms),clearInterval:id=>clearInterval(id)});
const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
let deferred={};const counts={'101':{activity:7,messages:{inbox:12,spam:3}},'202':{activity:2,messages:{inbox:1,spam:5}}};
const failures={};const calls={activity:0,messages:0};const routes=[];
const F=globalThis.F={routes,calls,async fetch(kind){calls[kind]++;const id=useAuthStore.getState().user?.id;const value=kind==='activity'?{unread:counts[id]?.activity??0,total:0}:counts[id]?.messages??{inbox:0,spam:0};if(deferred[kind]){await new Promise(resolve=>deferred[kind].push(resolve))}if(failures[kind])throw Error('Synthetic unavailable');return value;}};
let mountedRoot;export function mount(native=false){mountedRoot=createRoot(document.getElementById('root'));mountedRoot.render(<QueryClientProvider client={qc}>{native?<><TabsLayout/><TabHeaderRight/></>:<AppShell><div style={{color:'#ddd',padding:32}}>Synthetic badge fixture</div></AppShell>}</QueryClientProvider>)};
export function unmount(){mountedRoot?.unmount();qc.clear()}
export function setServer(kind,value,id=useAuthStore.getState().user?.id){counts[id][kind]=value}
export function fail(kind,value){failures[kind]=value}
export function refresh(kind){return qc.invalidateQueries({queryKey:kind==='activity'?notificationKeys.badges(useAuthStore.getState().user?.id):messageKeys.unreadCount(useAuthStore.getState().user?.id),exact:true})}
export function emit(table='notifications',type='INSERT'){for(const c of supabase.getChannels())for(const h of c.handlers)if(h.filter.table===table)h.callback({eventType:type})}
export function reconnect(){for(const c of supabase.getChannels())c.status?.('SUBSCRIBED')}
export function focus(value){focusManager.setFocused(value)}
export function online(value){onlineManager.setOnline(value)}
export function switchUser(id){useAuthStore.setState({user:id?{id,username:'fixture'}:null})}
export function defer(kind){deferred[kind]=[]}
export function release(kind){const resolvers=deferred[kind];delete deferred[kind];resolvers.forEach(r=>r())}
export function snapshot(){return {calls:{...calls},channels:supabase.getChannels().map(c=>({topic:c.topic,filters:c.handlers.map(h=>h.filter)})),routes:[...routes]}}
export function read(){const viewer='101';const key=messageKeys.unreadCount(viewer);qc.setQueryData(key,{inbox:12,spam:99,inboxConversationIds:['55',...Array.from({length:11},(_,i)=>String(i+100))],spamConversationIds:Array.from({length:99},(_,i)=>String(i+500))});qc.setQueryData([...messageKeys.all(viewer),'filtered','primary'],[{id:'55',unread:true},{id:'blocked',unread:true}]);reconcileConversationReadState(qc,viewer,'blocked',{inbox:999,spam:999,authoritative:true});reconcileConversationReadState(qc,viewer,'55');reconcileConversationReadState(qc,viewer,'55');return qc.getQueryData(key)}
export function oldObserver(){const release=observeUnreadChanges(qc,'101','activity');const c=supabase.getChannels().find(c=>c.topic.includes('activity:101'));release();return c}
`;
(async()=>{
  await build({stdin:{contents:entry,resolveDir:root,loader:"tsx"},outfile:path.join(dir,"fixture.js"),bundle:true,format:"iife",globalName:"BadgeFixture",platform:"browser",jsx:"automatic",nodePaths:paths,alias:{"@dvnt/app":path.join(root,"packages/app"),...deps},plugins:[plugin],define:{"process.env.NODE_ENV":'"test"'},tsconfigRaw:{}});
  if(process.env.BADGE_TEST_DOM === "1") {
    const {Window}=require(resolve("happy-dom"));
    const win=new Window({url:"http://localhost",width:390,height:844});
    win.console.timeStamp=()=>{};
    win.document.body.innerHTML='<div id="root"></div>';
    win.eval(fs.readFileSync(path.join(dir,"fixture.js"),"utf8"));
    const app=win.BadgeFixture;
    const delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await delay(10)}throw Error("Timeout: "+label+"\n"+win.document.body.innerHTML+"\n"+JSON.stringify(app.snapshot())+"\n"+win.happyDOM.virtualConsolePrinter.readAsString())};
    const btn=name=>[...win.document.querySelectorAll('[role="button"],button')].find(n=>n.getAttribute('aria-label')?.startsWith(name));
    const label=name=>btn(name)?.getAttribute('aria-label');
    try {
      app.mount();await wait(()=>label('Messages')==='Messages, 12 unread conversations'&&label('Activity')==='Activity, 7 unread notifications','initial counts');
      assert.equal(app.snapshot().channels.length,2,'parent+children share channels');
      const focused=btn('Activity');focused.focus();app.setServer('activity',100);app.emit();app.emit();await wait(()=>label('Activity')==='Activity, 100 unread notifications','duplicate incoming');assert.equal(btn('Activity'),focused,'tab DOM not remounted');assert.ok(btn('Activity').textContent.includes('99+'));
      app.setServer('messages',{inbox:12,spam:99});app.emit('messages');app.emit('messages');await delay(40);assert.equal(label('Messages'),'Messages, 12 unread conversations','thread deliveries and Requests excluded');
      app.setServer('messages',{inbox:11,spam:99});assert.equal(app.read().inbox,11,'confirmed read is idempotent and ignores unscoped store999');await wait(()=>label('Messages')==='Messages, 11 unread conversations','read redraw');
      app.fail('activity',true);await app.refresh('activity');await delay(40);assert.equal(label('Activity'),'Activity, 100 unread notifications','error preserves last good count');
      app.fail('activity',false);app.setServer('activity',0);app.emit('notifications','UPDATE');await wait(()=>label('Activity')==='Activity','zero hide');assert.equal(btn('Activity').textContent,'Activity');
      app.setServer('activity',3);app.reconnect();await wait(()=>label('Activity')==='Activity, 3 unread notifications','resubscribe');
      app.focus(false);const calls=app.snapshot().calls.activity;app.setServer('activity',4);await delay(450);assert.equal(app.snapshot().calls.activity,calls,'hidden polling disabled');app.focus(true);await wait(()=>label('Activity')==='Activity, 4 unread notifications','foreground');
      app.setServer('activity',5);await wait(()=>label('Activity')==='Activity, 5 unread notifications','foreground fallback poll');
      app.online(false);app.setServer('messages',{inbox:8,spam:99});app.online(true);await wait(()=>label('Messages')==='Messages, 8 unread conversations','network reconnect');
      app.defer('messages');app.setServer('messages',{inbox:42,spam:0});app.refresh('messages');await delay(20);app.switchUser('202');await wait(()=>label('Activity')==='Activity, 2 unread notifications','switch account');assert.ok(!btn('Messages').textContent.includes('42'));app.release('messages');await wait(()=>label('Messages')==='Messages, 1 unread conversation','late old completion');
      win.happyDOM.setWindowSize({width:1440,height:900});win.dispatchEvent(new win.Event('resize'));await wait(()=>btn('Activity')?.tagName==='BUTTON','desktop rail');const rail=btn('Activity');rail.focus();app.setServer('activity',123);app.emit();await wait(()=>label('Activity')==='Activity, 123 unread notifications','rail unread');assert.equal(btn('Activity'),rail,'rail DOM not remounted');
      win.happyDOM.setWindowSize({width:850,height:900});win.dispatchEvent(new win.Event('resize'));await delay(30);assert.equal(label('Activity'),'Activity, 123 unread notifications');btn('Messages').click();assert.equal(app.snapshot().routes.at(-1),'/feed/messages');
      app.switchUser(null);await wait(()=>label('Activity')==='Activity'&&label('Messages')==='Messages','logout');assert.equal(app.snapshot().channels.length,0);app.unmount();
      app.switchUser('101');app.setServer('activity',7);app.setServer('messages',{inbox:12,spam:3});app.mount(true);await wait(()=>win.document.querySelector('[data-native-badge]')?.textContent==='7','native tab wiring');await wait(()=>label('Messages')==='Messages, 12 unread conversations','native header');app.setServer('activity',101);app.emit();await wait(()=>win.document.querySelector('[data-native-badge]')?.textContent==='99+','native cap');app.setServer('activity',0);app.emit();await wait(()=>!win.document.querySelector('[data-native-badge]'),'native zero');app.unmount();
      console.log('PASS mounted React/TanStack/RNWeb DOM: mobile header/tabbar, desktop and collapsed rails, native badge wiring, counts/cap/zero/a11y/focus, dedup/read/errors/accountswitch/logout/focus/reconnect/foreground poll');
    } finally {await win.happyDOM.close()}
    return;
  }
  const server=http.createServer((req,res)=>{res.setHeader("Content-Type",req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?fs.readFileSync(path.join(dir,'fixture.js')):'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;background:#06070d"><div id="root"></div><script src="/fixture.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':chromium.executablePath()),headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>BadgeFixture.mount());
    const activity=()=>page.getByRole('button',{name:/^Activity/});const messages=()=>page.getByRole('button',{name:/^Messages/});
    await messages().filter({hasText:'12'}).waitFor();await activity().filter({hasText:'7'}).waitFor();
    assert.equal(await messages().getAttribute('aria-label'),'Messages, 12 unread conversations');
    assert.equal(await activity().getAttribute('aria-label'),'Activity, 7 unread notifications');
    let state=await page.evaluate(()=>BadgeFixture.snapshot());assert.equal(state.channels.length,2,'chrome and child badges share only two channels');
    assert.ok(state.channels.some(c=>c.filters.some(f=>f.table==='conversation_reads'&&f.filter==='user_id=eq.101')));
    await activity().focus();await page.evaluate(()=>{globalThis.focusedActivity=document.activeElement;BadgeFixture.setServer('activity',100);BadgeFixture.emit();BadgeFixture.emit();});
    await activity().filter({hasText:'99+'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement===globalThis.focusedActivity),true,'refresh preserves focused tab node');
    await page.evaluate(()=>{BadgeFixture.setServer('messages',{inbox:12,spam:99});BadgeFixture.emit('messages');BadgeFixture.emit('messages');});
    await page.waitForTimeout(50);assert.equal(await messages().getAttribute('aria-label'),'Messages, 12 unread conversations','multiple same-thread deliveries and Requests never increment inbox');
    const read=await page.evaluate(()=>{BadgeFixture.setServer('messages',{inbox:11,spam:99});return BadgeFixture.read()});assert.equal(read.inbox,11,'repeat read decrements once and ignores foreign999 store');
    await messages().filter({hasText:'11'}).waitFor();
    await page.evaluate(()=>{BadgeFixture.fail('activity',true);BadgeFixture.refresh('activity')});await page.waitForTimeout(80);assert.equal(await activity().getAttribute('aria-label'),'Activity, 100 unread notifications','error keeps last confirmed count');
    await page.evaluate(()=>{BadgeFixture.fail('activity',false);BadgeFixture.setServer('activity',0);BadgeFixture.emit('notifications','UPDATE')});
    await page.waitForFunction(()=>document.querySelector('[aria-label="Activity"]'));assert.equal(await activity().innerText(),'Activity','zero removes badge');
    await page.evaluate(()=>{BadgeFixture.setServer('activity',3);BadgeFixture.reconnect()});await activity().filter({hasText:'3'}).waitFor();
    await page.evaluate(()=>BadgeFixture.focus(false));state=await page.evaluate(()=>BadgeFixture.snapshot());await page.evaluate(()=>BadgeFixture.setServer('activity',4));await page.waitForTimeout(440);assert.equal((await page.evaluate(()=>BadgeFixture.snapshot())).calls.activity,state.calls.activity,'no background polling');
    await page.evaluate(()=>BadgeFixture.focus(true));await activity().filter({hasText:'4'}).waitFor();
    await page.evaluate(()=>BadgeFixture.setServer('activity',5));await activity().filter({hasText:'5'}).waitFor();
    await page.evaluate(()=>{BadgeFixture.online(false);BadgeFixture.setServer('messages',{inbox:8,spam:99});BadgeFixture.online(true)});await messages().filter({hasText:'8'}).waitFor();
    await page.evaluate(()=>{BadgeFixture.defer('messages');BadgeFixture.setServer('messages',{inbox:42,spam:0});BadgeFixture.refresh('messages')});await page.waitForTimeout(20);await page.evaluate(()=>BadgeFixture.switchUser('202'));
    await activity().filter({hasText:'2'}).waitFor();assert.ok(!(await messages().innerText()).includes('42'));
    await page.evaluate(()=>BadgeFixture.release('messages'));await messages().filter({hasText:'1'}).waitFor();assert.equal(await messages().getAttribute('aria-label'),'Messages, 1 unread conversation','old account result never paints current badge');
    await page.setViewportSize({width:1440,height:900});await messages().filter({hasText:'1'}).waitFor();await activity().focus();await page.evaluate(()=>{globalThis.focusedActivity=document.activeElement;BadgeFixture.setServer('activity',123);BadgeFixture.emit()});await activity().filter({hasText:'99+'}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement===globalThis.focusedActivity),true,'rail focus survives refresh');
    await page.setViewportSize({width:850,height:900});assert.equal(await activity().getAttribute('aria-label'),'Activity, 123 unread notifications','collapsed rail retains full accessible name');
    await messages().click();assert.equal((await page.evaluate(()=>BadgeFixture.snapshot())).routes.at(-1),'/feed/messages');
    await page.evaluate(()=>BadgeFixture.switchUser(null));await page.waitForFunction(()=>document.querySelector('[aria-label="Activity"]')&&document.querySelector('[aria-label="Messages"]'));assert.equal((await page.evaluate(()=>BadgeFixture.snapshot())).channels.length,0,'logout detaches observers');
    await page.evaluate(()=>BadgeFixture.unmount());
    await page.reload();await page.evaluate(()=>BadgeFixture.mount(true));await page.locator('[data-native-badge]').filter({hasText:'7'}).waitFor();await messages().filter({hasText:'12'}).waitFor();await page.evaluate(()=>{BadgeFixture.setServer('activity',101);BadgeFixture.emit()});await page.locator('[data-native-badge]').filter({hasText:'99+'}).waitFor();await page.evaluate(()=>{BadgeFixture.setServer('activity',0);BadgeFixture.emit()});await page.waitForFunction(()=>!document.querySelector('[data-native-badge]'));
    assert.deepEqual(errors,[],'no render/runtime errors');
    if(process.env.BADGE_SCREENSHOT_DIR){fs.mkdirSync(process.env.BADGE_SCREENSHOT_DIR,{recursive:true});await page.reload();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{BadgeFixture.mount();BadgeFixture.setServer('activity',123);BadgeFixture.setServer('messages',{inbox:12,spam:3})});await page.getByRole('button',{name:'Activity, 123 unread notifications'}).waitFor();await page.screenshot({path:path.join(process.env.BADGE_SCREENSHOT_DIR,'mobile.png')});await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(process.env.BADGE_SCREENSHOT_DIR,'desktop.png')});}
    console.log('PASS actual web shell/mobile header/tabbar + native badge wiring: cap/zero/accessibility/focus, subscriptions/dedup, read/repeat, errors, polling/foreground/reconnect, switch/logout, navigation');
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
