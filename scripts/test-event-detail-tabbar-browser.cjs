#!/usr/bin/env node
// Production AppShell/WebTabBar, Dialog and BottomSheet; synthetic event content,
// router and auth. No backend, real event, purchase or review is exercised here.
// Browser layout is real; keyboard divergence is an explicit viewport contract,
// not a physical iOS keyboard. --dom checks lifecycle without layout/browser APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = process.env.TABBAR_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-detail-tabbar-'));
fs.mkdirSync(dir, { recursive: true });
const domOnly = process.argv.includes('--dom');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
// Reuse the actual detail control classes: the synthetic modal must not hide a
// production regression by supplying its own hard-coded 16px input styles.
const eventSource = read('packages/app/features/events/event-detail.web.tsx');
function detailControlClass(tag, marker) {
  const control = [...eventSource.matchAll(new RegExp('<'+tag+'\\b[\\s\\S]*?/>', 'g'))].map(m=>m[0]).find(text=>text.includes(marker));
  assert.ok(control, 'production event control exists: '+marker);
  const classes=control.match(/className="([^"]+)"/)?.[1];
  assert.ok(classes?.split(/\s+/).includes('text-base'), marker+' retains mobile 16px text');
  assert.ok(classes.split(/\s+/).includes('md:text-sm'), marker+' retains desktop typography');
  return classes;
}
const reviewClass=detailControlClass('textarea', 'Share how the event went');
const promoClass=detailControlClass('input', 'Promo or promoter code');
const mocks = {
    // This fixture covers layout; unread data/lifecycle is exercised separately.
    '@dvnt/app/lib/hooks/use-notifications-query': `export const useBadges=()=>({data:{unread:0,total:0}});`,
    '@dvnt/app/lib/hooks/use-messages': `export const useUnreadMessageCount=()=>({data:0,spamCount:0});`,
  'solito/navigation': `export const usePathname=()=>window.detailFixture.path; export const useRouter=()=>({push:path=>window.detailFixture.navigate(path)});`,
  '@dvnt/app/lib/stores/auth-store': `export const useAuthStore=selector=>selector({user:{username:'fixture-member'}});`,
  '@dvnt/app/components/logo': `export default ()=> <span>DVNT</span>;`,
  './web-top-bar.web': `export const WebTopBar=()=> <header style={{height:56}}>DVNT fixture</header>;`,
};
const client = `
  import React,{act,useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
  import {AppShell} from './packages/app/components/app-shell.web';
  import {BottomSheet} from './packages/app/components/bottom-sheet.web';
  import {Dialog} from './packages/ui/src/form/Dialog.web';
  const fixture=window.detailFixture={path:location.pathname,mounts:0,unmounts:0};
  function EventContent(){
    const [review,setReview]=useState(false),[checkout,setCheckout]=useState(false),[draft,setDraft]=useState('Retained fixture draft');
    useEffect(()=>{fixture.mounts++;return()=>{fixture.unmounts++}},[]);
    return <>
      <article data-event-fixture='' style={{padding:20,color:'white',minHeight:2400}}>
        <h1>Game Night in LA — layout fixture</h1>
        <label>Retained draft<input aria-label='Retained draft' value={draft} onChange={e=>setDraft(e.target.value)} style={{fontSize:16}}/></label>
        <button onClick={()=>setReview(true)}>Write fixture review</button>
        <button onClick={()=>setCheckout(true)}>Open fixture checkout</button>
        <div id='nested-scroll' style={{height:240,overflow:'auto',transform:'translateZ(0)',contain:'paint',marginTop:30}}><div style={{height:1400}}>Nested event content</div></div>
        <section data-host-card='' style={{marginTop:950,border:'1px solid #40384f',padding:32,borderRadius:20}}><h2>Hosted by fixture organizer</h2><p>No production attendee or ticket data.</p></section>
      </article>
      <Dialog open={review} onClose={()=>setReview(false)} title='Fixture review'>
        <textarea aria-label='Fixture review text' className=${JSON.stringify(reviewClass)}/>
      </Dialog>
      <BottomSheet open={checkout} onClose={()=>setCheckout(false)} title='Fixture checkout'>
        <input aria-label='Fixture promo code' className=${JSON.stringify(promoClass)}/>
        <p>Layout only. No submit or payment action.</p>
      </BottomSheet>
    </>;
  }
  function App(){
    const [route,setRoute]=useState(location.pathname);fixture.path=route;
    fixture.navigate=next=>{history.pushState({},'',next);setRoute(next)};
    useEffect(()=>{const pop=()=>setRoute(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop)},[]);
    return <AppShell><div data-route={route}><EventContent/></div></AppShell>;
  }
  const app=createRoot(document.getElementById('root'));fixture.unmount=()=>app.unmount();fixture.mount=()=>app.render(<React.StrictMode><App/></React.StrictMode>);
  export {act};
`;
(async () => {
  let browser, page, dom;
  try {
    await build({ bundle:true, jsx:'automatic', tsconfigRaw:{}, platform:domOnly?'node':'browser', format:domOnly?'cjs':'iife', outfile:path.join(dir,'detail-app.js'),
      nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
      alias:{'@dvnt/app':path.join(root,'packages/app'),'react-native':'react-native-web'},
      plugins:[{name:'detail-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{
        const key=mocks[args.path]?args.path:Object.keys(mocks).find(key=>key.startsWith('@dvnt/app/')&&args.path===path.join(root,'packages/app',key.slice('@dvnt/app/'.length)));
        if(key)return {path:key,namespace:'mock'};
      });b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));}}],
      stdin:{resolveDir:root,loader:'tsx',contents:client}});
    const tw=path.dirname(require.resolve('tailwindcss/package.json'));
    const globals=read('apps/web/src/app/(frontend)/globals.css');
    const sourceFiles=['packages/ui/src/form/Dialog.web.tsx','packages/app/components/bottom-sheet.web.tsx'];
    const candidates=sourceFiles.flatMap(p=>read(p).match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[]).concat(reviewClass.split(/\s+/),promoClass.split(/\s+/));
    const compiler=await compile(readFrom(tw,'theme.css')+'\n'+readFrom(tw,'preflight.css')+'\n@tailwind utilities important;\n'+globals.slice(globals.indexOf('/* ── Deviant brand tokens')));
    fs.writeFileSync(path.join(dir,'detail-style.css'),compiler.build(candidates));
    if(process.argv.includes('--build-only')){console.log('PASS event-detail chrome fixture and production modal CSS bundle (not browser execution)');return;}

    if(domOnly){
      const {Window}=await import(require.resolve('happy-dom'));
      dom=new Window({url:'https://dvnt.fixture/events/game-night-la'});
      const viewport=new dom.EventTarget();Object.assign(viewport,{height:852,width:393,offsetTop:0,scale:1});
      Object.defineProperty(dom,'visualViewport',{value:viewport,configurable:true});
      Object.defineProperties(dom.document.documentElement,{clientWidth:{get:()=>393},clientHeight:{get:()=>852}});
      Object.assign(global,{window:dom,document:dom.document,HTMLElement:dom.HTMLElement,ShadowRoot:dom.ShadowRoot,location:dom.location,history:dom.history,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:dom.requestAnimationFrame.bind(dom),cancelAnimationFrame:dom.cancelAnimationFrame.bind(dom),addEventListener:dom.addEventListener.bind(dom),removeEventListener:dom.removeEventListener.bind(dom)});
      document.body.innerHTML='<div id="ancestor"><div id="root"></div></div>';
      const {act}=require(path.join(dir,'detail-app.js'));
      await act(async()=>window.detailFixture.mount());
      const bar=()=>document.querySelector('[data-dvnt-tab-bar]');
      const settle=()=>act(async()=>{await new Promise(resolve=>dom.requestAnimationFrame(()=>dom.requestAnimationFrame(resolve)))});
      const setMetrics=async(height,offsetTop,event='resize')=>{viewport.height=height;viewport.offsetTop=offsetTop;await act(async()=>{(event==='pageshow'?dom:viewport).dispatchEvent(new dom.Event(event))});await settle();};
      assert.equal(bar().parentElement,document.body);
      assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'852px');
      const article=document.querySelector('[data-event-fixture]'),mounts=window.detailFixture.mounts;
      for(const route of ['/events/game-night-la/','/feed/events/42','/feed/events/42/']){
        await act(async()=>window.detailFixture.navigate(route));
        for(const metrics of [[500,0],[470,70],[852,0]]){await setMetrics(...metrics);assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),`${metrics[0]+metrics[1]}px`);}
        assert.equal(document.querySelector('[data-event-fixture]'),article);assert.equal(window.detailFixture.mounts,mounts);
      }
      for(const route of ['/feed/events/42/comments','/feed/messages/fixture-chat','/feed']){
        await act(async()=>window.detailFixture.navigate(route));
        assert.equal(bar().style.bottom,'0px');assert.equal(bar().style.top,'');assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'');
        await setMetrics(500,70);assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'','unrelated routes retain existing chrome contract');
      }
      await act(async()=>window.detailFixture.navigate('/events/game-night-la'));
      await setMetrics(852,0,'pageshow');assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'852px');
      for(const opener of ['Write fixture review','Open fixture checkout']){
        for(let i=0;i<2;i++){
          const button=[...document.querySelectorAll('button')].find(b=>b.textContent===opener);
          await act(async()=>button.click());assert.ok(document.querySelector('[role="dialog"]'));
          await setMetrics(480,40);assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'520px');
          await act(async()=>dom.dispatchEvent(new dom.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
          assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.body.style.overflow,'');
          await setMetrics(852,0);assert.equal(bar().style.getPropertyValue('--dvnt-visible-bottom'),'852px');
        }
      }
      const detached=bar();await act(async()=>window.detailFixture.unmount());
      assert.equal(bar(),null);await setMetrics(600,30);assert.equal(detached.style.getPropertyValue('--dvnt-visible-bottom'),'','cleanup cancels listeners and clears old node');
      console.log('PASS event-detail chrome DOM: exact aliases, unrelated route cleanup, modal Escape/reopen, viewport/pageshow recovery, stable content and StrictMode cleanup. Geometry, touch hit-testing and iOS keyboard NOT tested in DOM lane.');return;
    }

    const engine=process.env.TABBAR_BROWSER==='webkit'?webkit:chromium;
    browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}: {})});
    page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'+fs.readFileSync(path.join(dir,'detail-style.css'),'utf8')+'</style></head><body style="margin:0;background:#06070d"><div id="ancestor"><div id="root"></div></div></body></html>';
    await page.route('https://dvnt.fixture/**',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('https://dvnt.fixture/events/game-night-la');
    await page.addScriptTag({path:path.join(dir,'detail-app.js')});
    await page.evaluate(()=>detailFixture.mount());
    const bar=page.locator('[data-dvnt-tab-bar]');await bar.waitFor();
    const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const pinned=async label=>{await settle();const g=await bar.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,expected:visualViewport.offsetTop+visualViewport.height,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:document.documentElement.clientWidth,bodyChild:el.parentElement===document.body}));assert.ok(Math.abs(g.bottom-g.expected)<1,label+': '+JSON.stringify(g));assert.equal(g.left,0);assert.equal(g.right,g.width);assert.equal(g.bodyChild,true);};
    await pinned('initial public-title alias');
    await page.getByLabel('Retained draft').fill('Keep event draft');
    await page.evaluate(()=>{window.detailFixture.originalNode=document.querySelector('[data-event-fixture]');window.detailFixture.originalMounts=window.detailFixture.mounts;window.detailFixture.viewportOriginals={};for(const key of ['height','offsetTop'])window.detailFixture.viewportOriginals[key]=Object.getOwnPropertyDescriptor(visualViewport,key);});
    const setMetrics=(metrics,event='resize')=>page.evaluate(({metrics,event})=>{for(const [key,value]of Object.entries(metrics))Object.defineProperty(visualViewport,key,{configurable:true,value});(event==='pageshow'?window:visualViewport).dispatchEvent(new Event(event));},{metrics,event});
    const restoreMetrics=()=>page.evaluate(()=>{for(const [key,value]of Object.entries(window.detailFixture.viewportOriginals)){if(value)Object.defineProperty(visualViewport,key,value);else delete visualViewport[key];}visualViewport.dispatchEvent(new Event('resize'));});
    const stable=async()=>{assert.equal(await page.getByLabel('Retained draft').inputValue(),'Keep event draft');assert.equal(await page.evaluate(()=>document.querySelector('[data-event-fixture]')===detailFixture.originalNode&&detailFixture.mounts===detailFixture.originalMounts),true);};
    await page.locator('#ancestor').evaluate(el=>{el.style.transform='translateZ(0)';el.style.contain='paint';});
    for(const top of [400,1200,2200,0]){await page.evaluate(top=>scrollTo(0,top),top);await pinned('transformed ancestor document scroll '+top);}
    for(const top of [800,0]){await page.locator('#nested-scroll').evaluate((el,top)=>{el.scrollTop=top},top);await pinned('nested scroll '+top);}
    // Dialog is intentionally not tested inside a transformed containing block:
    // unlike the tab bar and BottomSheet, this production Dialog is not portalled.
    await page.locator('#ancestor').evaluate(el=>{el.style.transform='';el.style.contain='';});
    for(const route of ['/feed/events/42','/events/game-night-la/']){
      await page.evaluate(route=>detailFixture.navigate(route),route);await pinned('event alias '+route);
      for(const opener of ['Write fixture review','Open fixture checkout']){
        for(let i=0;i<2;i++){
          await page.getByRole('button',{name:opener,exact:true}).click();
          const dialog=page.getByRole('dialog');await dialog.waitFor();
          await dialog.getByRole('textbox').fill('Retain modal text');
          assert.equal(await dialog.getByRole('textbox').evaluate(el=>getComputedStyle(el).fontSize),'16px','production detail control classes avoid mobile focus zoom');
          await setMetrics({height:480,offsetTop:70});await pinned('open '+opener);
          if(i===0)await dialog.getByRole('button',{name:'Close',exact:true}).click();else await page.keyboard.press('Escape');
          await dialog.waitFor({state:'detached'});
          await setMetrics({height:852,offsetTop:0});await pinned('closed '+opener);
          assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
          await stable();
        }
      }
    }
    for(const metrics of [{height:500,offsetTop:0},{height:470,offsetTop:70},{height:852,offsetTop:0},{height:760,offsetTop:0},{height:852,offsetTop:0}]){await setMetrics(metrics);await pinned('viewport divergence/recovery '+JSON.stringify(metrics));}
    await setMetrics({height:840,offsetTop:0},'pageshow');await pinned('BFCache pageshow recovery');
    await restoreMetrics();await pinned('real metrics restored');
    for(const route of ['/feed/events/42/comments','/feed/messages/fixture-chat','/feed']){
      await page.evaluate(route=>detailFixture.navigate(route),route);await settle();
      assert.deepEqual(await bar.evaluate(el=>({bottom:el.style.bottom,top:el.style.top,variable:el.style.getPropertyValue('--dvnt-visible-bottom')})),{bottom:'0px',top:'',variable:''},'unrelated route '+route+' retains prior positioning');
      await setMetrics({height:500,offsetTop:70});await settle();assert.equal(await bar.evaluate(el=>el.style.getPropertyValue('--dvnt-visible-bottom')),'');
      await restoreMetrics();await page.goBack();await pinned('Back to event from '+route);
      await page.goForward();await settle();assert.equal(await bar.evaluate(el=>el.style.top),'');
      await page.goBack();await pinned('Back repeated from '+route);
    }
    await page.evaluate(()=>detailFixture.navigate('/feed/events/42'));
    for(const viewport of [{width:320,height:568},{width:430,height:932},{width:767,height:900},{width:852,height:393},{width:393,height:852}]){
      await page.setViewportSize(viewport);await settle();
      if(viewport.width<768){await bar.waitFor();await pinned('resize '+JSON.stringify(viewport));}else await bar.waitFor({state:'detached'});
      await stable();
    }
    if(engine===chromium){
      const cdp=await page.context().newCDPSession(page);
      for(const scale of [1.5,2,1]){await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:scale});await pinned('real pinch-scale emulation '+scale);}
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:34}});await pinned('safearea34');
      assert.equal(await bar.locator(':scope > div').evaluate(el=>getComputedStyle(el).paddingBottom),'42px');
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:0}});
    }
    await page.locator('[data-host-card]').scrollIntoViewIfNeeded();await pinned('host card after recovery');
    await page.screenshot({path:path.join(dir,'event-detail-host-card.png')});
    await bar.getByRole('button',{name:'Events',exact:true}).click();await settle();assert.equal(await page.evaluate(()=>location.pathname),'/events');
    await page.goBack();await pinned('return after real nav press');
    await page.evaluate(()=>detailFixture.unmount());await bar.waitFor({state:'detached'});assert.deepEqual(errors,[]);
    console.log('PASS event-detail chrome browser fixture: event aliases, production modal Close/Escape/reopen, visual viewport recovery, navigation Back/Forward, nested/transformed ancestors, 320–852px, retained content, Chromium zoom/safe area, screenshot. Synthetic content/router; physical iOS keyboard and live event screen NOT tested. Evidence:',dir);
  }catch(error){if(page)await page.screenshot({path:path.join(dir,'event-detail-failure.png')}).catch(()=>{});throw error;}
  finally{await browser?.close();if(dom){await dom.happyDOM.abort();await dom.happyDOM.close();}}
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
function readFrom(base,file){return fs.readFileSync(path.join(base,file),'utf8');}
