#!/usr/bin/env node
/**
 * Chromium regression against the actual EventDetailScreen, its UI components,
 * pricing/selection helpers and Zustand UI state. Only service/data boundaries
 * (hooks, APIs, auth and checkout dispatch) are fixtures. No live account,
 * checkout, hold, order, or external request is used.
 *
 * node scripts/test-event-purchase-layout.cjs
 * CHROME_EXECUTABLE_PATH=/usr/bin/chromium uses an installed Chromium.
 * EVENT_PURCHASE_OUTPUT_DIR selects the screenshot/JSON output directory.
 * NODE_PATH may point to fixture dependencies outside the checkout.
 * --build-only verifies the source graph/CSS, not browser layout.
 * --serve keeps the local fixture running for manual browser inspection.
 * --smoke mounts the full bundle in jsdom; it does not verify browser geometry.
 * --emit-fixture writes authored HTML/JS/CSS to the output directory for inspection.
 *
 * This is a screen-level fixture, not the Next app shell or payment-provider E2E.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const source = (file) => path.join(ROOT, file);
const dependencyPaths = [ROOT, source('apps/web'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = (name) => require.resolve(name, { paths: dependencyPaths });
const load = (name) => require(resolve(name));
const nodePaths = [...new Set(dependencyPaths.flatMap(p => [p, path.join(p, 'node_modules')]))];
const OUT = process.env.EVENT_PURCHASE_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-event-purchase-'));
const PAID = '22222222-2222-4222-8222-222222222222';
const FREE = '11111111-1111-4111-8111-111111111111';
const VIP = '33333333-3333-4333-8333-333333333333';

const fixture = `
  import {create} from 'zustand';
  import {useEventDetailUiStore} from '@dvnt/app/lib/stores/event-detail-ui-store';
  export const noop=()=>{};
  export const query=(data,patch={})=>({data,isPending:false,isFetching:false,isError:false,refetch:noop,...patch});
  export const mutation={isPending:false,isError:false,mutate:noop,mutateAsync:async()=>({})};
  const tier={event_id:42,quantity_total:100,quantity_sold:0,is_active:true,status:'on_sale',perks:[]};
  export const tiers=[
    {...tier,id:'${FREE}',name:'Free RSVP',price_cents:0,description:'Free admission ticket.'},
    {...tier,id:'${PAID}',name:'General admission',price_cents:3000,description:'Admission for one person.'},
    {...tier,id:'${VIP}',name:'VIP',price_cents:5000,description:'VIP admission. See the organizer’s event description for details.'}
  ];
  if(new URLSearchParams(location.search).has('long'))tiers.forEach((t,i)=>{t.name=['Free community admission with advance registration','General admission for the late-night community celebration','VIP admission for the complete evening'][i];t.description='Organizer-provided details may take several lines on a smaller screen.'});
  if(new URLSearchParams(location.search).has('configured'))tiers[2].perks=['Organizer-listed coat check'];
  export const ownedTicket={id:'fixture-ticket',event_id:42,ticket_type_id:'${PAID}',purchase_amount_cents:3000,status:'active',event_title:'NYC Black Out · Layout fixture'};
  export const event={id:42,title:'NYC Black Out · Layout fixture',description:'Music, community, and a night out. Select a ticket above to continue.',
    image:'./fixture-flyer.svg',price:30,ticketingEnabled:true,ticketTiers:tiers,visibility:'public',status:'active',
    host:{id:'fixture-host',username:'community',avatar:'./fixture-avatar.svg'},location:'Brooklyn, NY',
    fullDate:'2099-06-20T23:00:00Z',event_tz:'America/New_York',lineup:['Local selectors'],perks:[],attendees:[]};
  export const useFixture=create(()=>({event,tiers,authenticated:false}));
  export const f=window.fixture={checkouts:[],rsvps:[],routes:[],storyShares:[],attendancePrivacy:[],ui:useEventDetailUiStore,
    configure:patch=>useFixture.setState(patch),configureTickets:tiers=>useFixture.setState(s=>({tiers,event:{...s.event,ticketTiers:tiers}})),reset:()=>{useEventDetailUiStore.getState().reset();f.checkouts=[];f.rsvps=[];f.routes=[];f.storyShares=[];f.attendancePrivacy=[];useFixture.setState({event,tiers,authenticated:false})}};
  export const store=state=>Object.assign((select=s=>s)=>select(state),{getState:()=>state});
  export const guestCheckout=store({open:false,email:'',eventId:'42',tierId:'',requestKey:'fixture',quantity:1,
    discountCode:'',trackedPromoterCode:'',codeDraft:'',quoteRevision:0,patch:noop,
    openSheet:value=>f.checkouts.push(value)});
  export const guestRsvp=store({open:false,patch:noop,openSheet:(...value)=>f.rsvps.push(value)});
`;
const boundaries = new Map([
  ['fixture', fixture],
  ['solito/navigation', `import {f} from 'fixture';const router={push:url=>f.routes.push(url),back:()=>{}};export const useParams=()=>({id:'42'});export const usePathname=()=>'/public/events/42';export const useRouter=()=>router;`],
  ['@tanstack/react-query', `import {query,mutation} from 'fixture';export const useQuery=({queryKey})=>query(queryKey[1]==='share-token'?null:[]);export const useMutation=()=>mutation;export const useQueryClient=()=>({invalidateQueries:()=>{}});`],
  ['@dvnt/app/lib/hooks/use-events', `import {useFixture,query,mutation,f} from 'fixture';export const useEvents=()=>query([]);export const useEvent=()=>query(useFixture(s=>s.event));export const useDeleteEvent=()=>mutation;export const useToggleEventLike=()=>mutation;export const useRsvpEvent=()=>({...mutation,mutate:v=>f.rsvps.push(v)});export const eventKeys={all:['events']};`],
  ['@dvnt/app/lib/hooks/use-tickets', `import {useFixture,query,ownedTicket,noop} from 'fixture';export const useTicketRoute=()=>({isLoading:false,refetch:noop,resolution:{kind:'ticket',ticket:ownedTicket}});export const useTicketTypes=()=>query(useFixture(s=>s.tiers));export const useMyTicketStatusForEvent=()=>({primary:null,isPending:false,isError:false});export const useTicketViewerId=()=>useFixture(s=>s.authenticated)?'fixture-member':'anon';export const useTicketViewerAuthId=()=>null;export const useTicketViewerIdentityPending=()=>false;`],
  ['@dvnt/app/lib/hooks/use-ticket-checkout', `export const useTicketCheckout=()=>({checkout:()=>{},isLoading:false});`],
  ['@dvnt/app/lib/hooks/use-ticket-upgrade', `import {mutation} from 'fixture';export const useTicketUpgradeOptions=()=>[];export const useInitiateUpgrade=()=>mutation;`],
  ['@dvnt/app/lib/hooks/use-event-waitlist', `import {query,mutation} from 'fixture';export const useEventWaitlistStatus=()=>query(null);export const useJoinWaitlist=()=>mutation;export const useLeaveWaitlist=()=>mutation;`],
  ['@dvnt/app/lib/hooks/use-event-reviews', `import {mutation} from 'fixture';export const useCreateEventReview=()=>mutation;`],
  ['@dvnt/app/lib/hooks/use-age-verification', `import {query,mutation} from 'fixture';export const useAgeVerificationStatus=()=>query(null);export const needsAgeVerification=()=>false;export const useStartVerification=()=>mutation;export const useRefreshVerificationStatus=()=>mutation;`],
  ['@dvnt/app/lib/hooks/use-event-role', `export const useEventRole=()=>({role:null});`],
  ['@dvnt/app/lib/hooks/use-event-lynk-host', `export const useEventLynkHost=()=>({});`],
  ['@dvnt/app/lib/hooks/use-event-realtime', `export const useEventRealtime=()=>{};`],
  ['@dvnt/app/lib/hooks/use-event-organizer', `import {query} from 'fixture';export const useEventOrganizer=()=>query(null);export const useEventCoOrganizers=()=>query([]);`],
  ['@dvnt/app/lib/hooks/use-follow', `import {mutation} from 'fixture';export const useFollow=()=>mutation;`],
  // Keep the real story-share menu UI, but record its service dispatch instead
  // of importing the story mutation's live auth/Supabase graph into this fixture.
  // The actual share hook and backend behavior have their own attribution suite.
  ['@dvnt/app/lib/hooks/use-share-post-to-story', `import {f} from 'fixture';export const useSharePostToStory=()=>({isPending:false,shareEvent:(event,onShared)=>{f.storyShares.push({type:'event',id:String(event.id)});onShared?.()}});`],
  ['@dvnt/app/lib/hooks/use-weather', `import {query} from 'fixture';export const useWeatherForecast=()=>query([]);`],
  ['@dvnt/app/lib/color/useEventDominantColor', `export const useEventDominantColor=()=>({color:'#26173d'});`],
  ['@dvnt/app/lib/stores/auth-store', `import {useFixture} from 'fixture';export const useAuthStore=select=>{const authenticated=useFixture(s=>s.authenticated);return select({isAuthenticated:authenticated,user:authenticated?{id:'fixture-member',username:'member'}:null})};`],
  ['@dvnt/app/lib/stores/guest-checkout-store', `export {guestCheckout as useGuestCheckoutStore} from 'fixture';`],
  ['@dvnt/app/lib/stores/guest-rsvp-store', `export {guestRsvp as useGuestRsvpStore} from 'fixture';`],
  ['@dvnt/app/lib/stores/ui-store', `import {store,noop} from 'fixture';export const useUIStore=store({showToast:noop});`],
  ['@dvnt/app/lib/stores/ticket-store', `import {store,noop} from 'fixture';export const useTicketStore=store({setTicket:noop,clearTicket:noop});`],
  ['@dvnt/app/lib/stores/promotion-store', `import {store,noop} from 'fixture';export const usePromotionStore=store({openSheet:noop});`],
  ['@dvnt/app/lib/stores/sale-notify-store', `import {store,noop} from 'fixture';export const useSaleNotifyStore=store({subscribedEventIds:[],toggle:noop});`],
  ['@dvnt/app/lib/stores/promoter-ref-store', `import {store,noop} from 'fixture';export const usePromoterRefStore=store({refs:{},setRef:noop,getRef:()=>null});`],
  ['@dvnt/app/lib/stores/translation-store', `export const useContentTranslation=()=>({displayText:'',isTranslated:false});`],
  ['@dvnt/app/lib/stores/create-event-store', `import {store} from 'fixture';export const useCreateEventStore=store({});`],
  ['@dvnt/app/lib/stores/cart', `import {store} from 'fixture';export const useCartStore=store({});`],
  ['@dvnt/app/lib/stores/checkout-profile-store', `import {store,noop} from 'fixture';export const useCheckoutProfileStore=store({reset:noop});`],
  // Keep the real privacy hook and accordion; fixture only the paged service store.
  ['@dvnt/app/lib/stores/event-attendees-store', `import {store,noop,f} from 'fixture';const empty={rows:[],lastPageSize:0,loading:false};export const selectAttendees=()=>()=>empty;export const useEventAttendeesStore=store({seed:noop,loadMore:noop,setAllowed:(eventId,allowed)=>f.attendancePrivacy.push({eventId,allowed})});`],
  ['@dvnt/app/lib/api/promoters', `export const promotersApi={getClaim:async()=>null};`],
  ['@dvnt/app/lib/api/events', `export const eventsApi={};`],
  ['@dvnt/app/lib/api/ticket-types', `import {useFixture} from 'fixture';export const ticketTypesApi={getByEvent:async()=>useFixture.getState().tiers};`],
  ['@dvnt/app/lib/api/addons', `export const addonsApi={};`],
  ['@dvnt/app/lib/api/weather', `export const mapWeatherToIcon=()=>'sun';`],
  ['@dvnt/app/lib/api/users', `export const usersApi={searchUsers:async()=>({docs:[]})};`],
  ['@dvnt/app/lib/api/messages-impl', `export const messagesApi={};`],
  ['@dvnt/app/lib/api/privileged', `export const inviteEventGuests=()=>{};`],
  ['@dvnt/app/lib/api/invoke-edge', `export const invokeEdge=()=>{throw Error('Unexpected edge call in isolated layout test')};`],
  ['@dvnt/app/lib/supabase/client', `export const supabase={functions:{invoke:()=>{throw Error('Unexpected network operation in isolated layout test')}}};`],
  ['@dvnt/app/lib/auth/identity', `export const requireBetterAuthToken=()=>{throw Error('No authentication in isolated layout test')};`],
  ['@dvnt/app/lib/cache/propagate', `export const propagateEntity=()=>{};`],
  ['@dvnt/app/features/sneaky-lynk', `export const sneakyLynkApi={};`],
  ['@dvnt/observability/flows', `export const onboardingCheckpoint=()=>{};`],
  ['@dvnt/ui', `export {Dialog} from '${source('packages/ui/src/form/Dialog.web.tsx')}';`],
  [source('packages/app/features/events/use-checkout-code.web'), `export const useCheckoutCode=()=>({});`],
]);

async function buildFixture() {
  const built = await load('esbuild').build({
    stdin:{resolveDir:ROOT,loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {EventDetailScreen} from './packages/app/features/events/event-detail.web';import {TicketUpgradeScreen} from './packages/app/features/events/ticket-upgrade.web';import 'fixture';createRoot(document.getElementById('root')).render((location.pathname.endsWith('/upgrade')||new URLSearchParams(location.search).get('screen')==='upgrade')?<TicketUpgradeScreen/>:<EventDetailScreen/>);`},
    bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths,
    resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],
    define:{'process.env.NODE_ENV':'"test"','__DEV__':'false','global':'globalThis'},loader:{'.css':'empty'},
    plugins:[{name:'event-service-boundaries',setup(build){
      build.onResolve({filter:/.*/},args=>{
        const absolute=args.path.startsWith('.')?path.resolve(args.resolveDir,args.path):args.path;
        const key=boundaries.has(args.path)?args.path:boundaries.has(absolute)?absolute:null;
        if(key)return{path:key,namespace:'fixture'};
        if(args.path==='react-native')return{path:resolve('react-native-web')};
        if(args.path==='lucide-react-native')return{path:resolve('lucide-react')};
        if(args.path.startsWith('@dvnt/app/'))return build.resolve(source('packages/app/'+args.path.slice('@dvnt/app/'.length)),{resolveDir:ROOT,kind:args.kind});
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries.get(args.path),loader:'tsx',resolveDir:ROOT}));
    }}],
  });
  // Compile the actual production stylesheet, including its monorepo sources,
  // theme, preflight, and important utility configuration. No handwritten layout.
  const cssFile=source('apps/web/src/app/(frontend)/globals.css');
  const css=await load('postcss')([load('@tailwindcss/postcss')({base:ROOT})]).process(fs.readFileSync(cssFile,'utf8'),{from:cssFile});
  assert.match(css.css,/\.flex\s*\{/,'production Tailwind utilities must be generated');
  assert.match(built.outputFiles[0].text,/event-purchase/,'production purchase group hook must be bundled');
  return {js:built.outputFiles[0].text,css:css.css};
}

const sizes=[{name:'phone',width:390,height:844},{name:'tablet',width:768,height:1024},{name:'desktop',width:1440,height:1000}];
const tick=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#379ed8"/><stop offset="1" stop-color="#632785"/></linearGradient></defs><rect width="540" height="960" fill="#141425"/><circle cx="320" cy="320" r="290" fill="url(#g)"/><circle cx="100" cy="640" r="180" fill="#874e9f" opacity=".6"/><text x="45" y="770" fill="white" font-family="sans-serif" font-size="52" font-weight="bold">NYC</text><text x="45" y="830" fill="white" font-family="sans-serif" font-size="52" font-weight="bold">BLACK OUT</text><text x="45" y="885" fill="white" font-family="sans-serif" font-size="20">LOCAL LAYOUT TEST</text></svg>`;

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const built=await buildFixture();
  if(process.argv.includes('--smoke')){
    const {JSDOM,VirtualConsole}=load('jsdom');
    const errors=[];
    for(const screen of ['event','upgrade','upgrade-configured']){
      const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(String(error)));virtualConsole.on('error',(...args)=>errors.push(args.map(String).join(' ')));
      const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid/public/'+(screen==='event'?'events/42':'ticket/42/upgrade'+(screen==='upgrade-configured'?'?configured=1':'')),runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
      try{
        dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
        dom.window.eval(built.js);
        const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}throw Error('DOM smoke did not render '+screen+': '+errors.join('; '))};
        if(screen==='event'){
          await until(()=>dom.window.document.querySelector('[data-testid="event-purchase"]'));
          await until(()=>dom.window.fixture.attendancePrivacy.some(row=>row.eventId==='42'&&row.allowed===true));
          assert.equal(errors.length,0,'actual privacy hook and accordion mount without boundary errors');
          const button=id=>dom.window.document.querySelector('[data-testid="ticket-tier-'+id+'"]');
          assert.equal(button(PAID).getAttribute('aria-pressed'),'true');
          button(FREE).click();await until(()=>button(FREE).getAttribute('aria-pressed')==='true');
          assert.equal(dom.window.fixture.checkouts.length,0);
          dom.window.document.querySelector('[data-testid="event-purchase-action"]').click();
          assert.equal(dom.window.fixture.checkouts[0].tierId,FREE);
          button(PAID).click();await until(()=>button(PAID).getAttribute('aria-pressed')==='true');
          dom.window.document.querySelector('[data-testid="event-purchase-action"]').click();
          assert.equal(dom.window.fixture.checkouts[1].tierId,PAID);
          dom.window.document.querySelector('[aria-label="More"]').click();
          const shareButton=()=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='Share to Story');
          await until(shareButton);
          shareButton().click();
          await until(()=>!shareButton());
          assert.equal(JSON.stringify(dom.window.fixture.storyShares),JSON.stringify([{type:'event',id:'42'}]),'actual story menu dispatches the event at the service boundary');
        }else{
          await until(()=>dom.window.document.body.textContent.includes('VIP admission. See the organizer'));
          const text=dom.window.document.body.textContent;
          assert.doesNotMatch(text,/skip.the.line|VIP lounge|complimentary drinks|dedicated bar|priority entry/i);
          if(screen==='upgrade-configured')assert.match(text,/Organizer-listed coat check/);
          else assert.doesNotMatch(text,/You'll gain|You’ll gain/);
        }
      }finally{dom.window.close()}
    }
    assert.deepEqual(errors,[],'full real UI bundle has no runtime errors');
    console.log('PASS full actual-screen ReactDOM smoke: free/paid selection, deferred checkout dispatch, story-share menu dispatch, upgrade descriptions, configured-only benefits. Browser geometry is not checked.');return;
  }
  if(process.argv.includes('--emit-fixture')){
    fs.writeFileSync(path.join(OUT,'bundle.js'),built.js);
    fs.writeFileSync(path.join(OUT,'styles.css'),built.css);
    for(const file of ['fixture-flyer.svg','fixture-avatar.svg'])fs.writeFileSync(path.join(OUT,file),svg);
    fs.writeFileSync(path.join(OUT,'screen.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated event layout fixture</title><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="bundle.js"></script></html>');
    for(const size of sizes){
      const frame=(params='')=>'<!doctype html><html><meta charset="utf-8"><title>'+size.name+' event layout fixture</title><style>html,body{margin:0;background:#02030a;width:'+size.width+'px;height:'+size.height+'px}iframe{display:block;border:0;width:'+size.width+'px;height:'+size.height+'px}</style><iframe title="Production event screen" src="screen.html'+params+'"></iframe></html>';
      fs.writeFileSync(path.join(OUT,size.name+'-frame.html'),frame());
      fs.writeFileSync(path.join(OUT,size.name+'-long-frame.html'),frame('?long=1'));
      if(size.name==='phone')for(const configured of [false,true])fs.writeFileSync(path.join(OUT,'upgrade-phone-'+(configured?'configured':'empty')+'-frame.html'),frame('?screen=upgrade'+(configured?'&configured=1':'')));
    }
    console.log('Wrote isolated file fixtures: '+OUT);return;
  }
  if(process.argv.includes('--build-only')){console.log('PASS source bundle and production CSS; no browser checks run.');return;}
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const [type,body]=url.pathname==='/bundle.js'?['text/javascript',built.js]:url.pathname==='/styles.css'?['text/css',built.css]:url.pathname.endsWith('.svg')?['image/svg+xml',svg]:['text/html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Event purchase layout fixture</title><link rel="stylesheet" href="/styles.css"><div id="root"></div><script src="/bundle.js"></script></html>'];
    res.setHeader('Content-Type',type);res.end(body);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
  const origin=`http://127.0.0.1:${server.address().port}`;
  if(process.argv.includes('--serve')){console.log('Fixture URL: '+origin+'/public/events/42');await new Promise(()=>{});return;}
  let browser;
  const evidence={scope:'Actual EventDetailScreen and UI components with production CSS; data/service boundaries mocked. Guest checkout dispatch is recorded, not executed.',screens:[],checks:[],errors:[]};
  try{
    let chromium;try{({chromium}=load('playwright'))}catch{({chromium}=load('@playwright/test'))}
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],...(process.env.CHROME_EXECUTABLE_PATH?{executablePath:process.env.CHROME_EXECUTABLE_PATH}:{})});
    for(const size of sizes){
      const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1});
      page.on('pageerror',e=>evidence.errors.push({screen:size.name,message:e.message}));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.goto(origin+'/public/events/42');
      const purchase=page.getByTestId('event-purchase');
      await purchase.waitFor();await tick(page);
      assert.equal(await page.evaluate(()=>window.fixture.attendancePrivacy.some(row=>row.eventId==='42'&&row.allowed===true)),true,'real privacy hook keeps ordinary event attendance enabled');
      assert.equal(evidence.errors.length,0,'actual privacy hook and accordion mount without boundary errors');
      assert.equal(await purchase.count(),1,'one purchase group');
      assert.equal(await page.getByRole('heading',{name:'Tickets',exact:true}).count(),1,'one Tickets section');
      assert.equal(await page.getByTestId('event-purchase-action').count(),1,'one primary purchase CTA');
      const tiers=purchase.locator('[data-testid^="ticket-tier-"]');
      assert.equal(await tiers.count(),3,'all choices are in the primary purchase group');
      assert.equal(await purchase.getByTestId('event-purchase-action').count(),1,'the CTA is in the same group');
      assert.equal(await page.getByTestId('ticket-tier-'+PAID).getAttribute('aria-pressed'),'true','default paid tier is highlighted');
      assert.equal(await purchase.locator('[aria-pressed="true"]').count(),1,'one selected ticket');
      const geometry=await page.evaluate(()=>{
        const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
        const p=document.querySelector('[data-testid="event-purchase"]');
        const about=[...document.querySelectorAll('h2')].find(el=>el.textContent==='About');
        const tickets=[...document.querySelectorAll('[data-testid^="ticket-tier-"]')];
        return{purchase:box(p),about:box(about),tiers:tickets.map(box),scrollWidth:document.documentElement.scrollWidth,innerWidth,bodyWidth:document.body.scrollWidth,
          followsAbout:!!(p.compareDocumentPosition(about)&Node.DOCUMENT_POSITION_FOLLOWING)};
      });
      assert.ok(geometry.followsAbout&&geometry.purchase.bottom<=geometry.about.y,'all ticket choices and CTA precede About');
      assert.ok(geometry.scrollWidth<=size.width&&geometry.bodyWidth<=size.width,'no page horizontal overflow');
      for(const rect of geometry.tiers){assert.ok(rect.x>=0&&rect.right<=size.width,'tier stays inside viewport width');assert.ok(rect.height>=44,'tier tap target is at least 44px tall');}
      for(let i=1;i<geometry.tiers.length;i++)assert.ok(geometry.tiers[i-1].bottom<=geometry.tiers[i].y+1,'ticket choices do not overlap');
      assert.doesNotMatch(await purchase.innerText(),/skip.the.line|priority entry|VIP lounge|complimentary|bottle service|dedicated host/i,'no tier-name-derived promises');
      const full=path.join(OUT,size.name+'-full.png'),focused=path.join(OUT,size.name+'-purchase.png');
      await page.screenshot({path:full,fullPage:true});
      await page.evaluate(()=>{const p=document.querySelector('[data-testid="event-purchase"]');window.scrollTo(0,Math.max(0,p.getBoundingClientRect().top+scrollY-160))});
      await tick(page);await page.screenshot({path:focused});
      // Native keyboard navigation, not locator.focus(), must reach each tier
      // and the sole CTA. Activation of a choice may only update selection.
      await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});
      const focusedIds=[];
      for(let step=0;step<40;step++){
        await page.keyboard.press('Tab');
        const active=await page.evaluate(()=>({id:document.activeElement?.getAttribute('data-testid'),label:document.activeElement?.textContent?.trim()}));
        if(active.id?.startsWith('ticket-tier-'))focusedIds.push(active.id);
        if(active.label==='Get tickets')break;
      }
      assert.deepEqual(focusedIds,['ticket-tier-'+FREE,'ticket-tier-'+PAID,'ticket-tier-'+VIP],'keyboard tab reaches all tier choices before CTA');
      await page.keyboard.press('Shift+Tab');await page.keyboard.press('Space');await tick(page);
      assert.equal(await page.getByTestId('ticket-tier-'+VIP).getAttribute('aria-pressed'),'true','keyboard activation selects the tier');
      assert.equal(await page.evaluate(()=>window.fixture.checkouts.length),0,'keyboard tier selection does not start checkout');
      for(const id of [FREE,PAID,VIP]){
        await page.getByTestId('ticket-tier-'+id).click();await tick(page);
        assert.equal(await page.getByTestId('ticket-tier-'+id).getAttribute('aria-pressed'),'true','clicked tier selected');
        assert.equal(await purchase.locator('[aria-pressed="true"]').count(),1,'selection stays exclusive');
        const state=await page.evaluate(()=>({checkouts:window.fixture.checkouts,rsvps:window.fixture.rsvps,routes:window.fixture.routes,open:window.fixture.ui.getState().checkoutOpen}));
        assert.deepEqual(state,{checkouts:[],rsvps:[],routes:[],open:false},'selecting a tier does not initiate checkout, RSVP, or navigation');
      }
      // Both a free and paid tier must survive until the primary CTA is used.
      for(const [id,cents] of [[FREE,0],[PAID,3000]]){
        await page.getByTestId('ticket-tier-'+id).click();await tick(page);
        await purchase.getByTestId('event-purchase-action').click();await tick(page);
        const checkout=await page.evaluate(()=>window.fixture.checkouts.at(-1));
        assert.equal(checkout.tierId,id,'CTA uses selected tier');assert.equal(checkout.priceCents,cents,'CTA preserves selected price');
        assert.equal(await page.evaluate(()=>window.fixture.rsvps.length),0,'a free ticket is still ticket checkout, not tier-less RSVP');
      }
      evidence.screens.push({...size,geometry,screenshots:[full,focused]});
      evidence.checks.push(size.name+': grouped-before-About, one CTA, selected default, no overflow/overlap, keyboard, selection-only clicks, free/paid CTA dispatch');
      // Stress realistic long names/descriptions without changing production markup.
      await page.evaluate(()=>{
        const state=window.fixture;
        const tiers=[
          {id:'11111111-1111-4111-8111-111111111111',name:'Free community admission with advance registration',price_cents:0},
          {id:'22222222-2222-4222-8222-222222222222',name:'General admission for the late-night community celebration',price_cents:3000},
          {id:'33333333-3333-4333-8333-333333333333',name:'VIP admission for the complete evening',price_cents:5000}
        ].map(t=>({...t,event_id:42,quantity_total:100,quantity_sold:0,is_active:true,status:'on_sale',description:'Organizer-provided details may take several lines on a smaller screen.',perks:[]}));
        state.configureTickets(tiers);
        window.scrollTo(0,Math.max(0,document.querySelector('[data-testid="event-purchase"]').getBoundingClientRect().top+scrollY-80));
      });
      await tick(page);
      assert.match(await purchase.innerText(),/General admission for the late-night community celebration/,'stress names actually rendered');
      assert.match(await purchase.innerText(),/Organizer-provided details may take several lines/,'stress descriptions actually rendered');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.body.scrollWidth<=innerWidth),true,'long ticket names do not cause horizontal overflow');
      assert.equal(await purchase.getByTestId('event-purchase-action').count(),1,'long names preserve the single purchase action');
      const longScreenshot=path.join(OUT,size.name+'-long-names.png');
      await page.screenshot({path:longScreenshot});
      evidence.screens.at(-1).screenshots.push(longScreenshot);
      evidence.checks.push(size.name+': long ticket names and descriptions do not overflow');
      await page.getByRole('button',{name:'More',exact:true}).click();
      const storyShare=page.getByRole('button',{name:'Share to Story',exact:true});
      await storyShare.click();await tick(page);
      assert.deepEqual(await page.evaluate(()=>window.fixture.storyShares),[{type:'event',id:'42'}],'actual story menu dispatches the event at the service boundary');
      assert.equal(await storyShare.count(),0,'successful share closes the actual event menu');
      evidence.checks.push(size.name+': actual story-share menu dispatch and close; service only is a fixture');
      await page.close();
    }
    for(const configured of [false,true]){
      const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
      page.on('pageerror',e=>evidence.errors.push({screen:'ticket-upgrade',message:e.message}));
      await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      await page.goto(origin+'/public/ticket/42/upgrade'+(configured?'?configured=1':''));
      await page.getByRole('heading',{name:'Move up a tier'}).waitFor();await tick(page);
      const text=await page.locator('body').innerText();
      assert.match(text,/VIP admission\. See the organizer’s event description for details\./,'organizer description remains visible');
      assert.doesNotMatch(text,/skip.the.line|VIP lounge|complimentary drinks|dedicated bar|priority entry/i,'no fabricated VIP upgrade promises');
      if(configured)assert.match(text,/Organizer-listed coat check/,'only configured perk is displayed');
      else assert.doesNotMatch(text,/You'll gain|You’ll gain|Organizer-listed coat check/,'empty perks have no benefits heading or fallback');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'upgrade phone does not overflow horizontally');
      const screenshot=path.join(OUT,'upgrade-phone-'+(configured?'configured-perks':'no-perks')+'.png');
      await page.screenshot({path:screenshot,fullPage:true});
      evidence.screens.push({name:'upgrade-phone-'+(configured?'configured-perks':'no-perks'),width:390,height:844,screenshots:[screenshot]});
      evidence.checks.push('upgrade '+(configured?'configured perks preserved':'empty perks have no invented benefits')+' and organizer description visible');
      await page.close();
    }
    assert.deepEqual(evidence.errors,[],'no browser runtime errors');
    const upgrade=fs.readFileSync(source('packages/app/features/events/ticket-upgrade.web.tsx'),'utf8');
    assert.match(upgrade,/perks:\s*ticketUpgradeBenefits\(match\)/,'current upgrade tier uses explicitly configured benefits');
    assert.match(upgrade,/perks:\s*ticketUpgradeBenefits\(t\)/,'available upgrade tier uses explicitly configured benefits');
    assert.doesNotMatch(upgrade,/TIER_PERKS|DEFAULT_PERKS|skip.the.line|VIP lounge|complimentary drinks/i,'no upgrade fallback benefit promises');
    evidence.checks.push('ticket-upgrade source: current and offered tiers use explicit ticketUpgradeBenefits; no default benefits');
    console.log('PASS event purchase browser layout: '+JSON.stringify(evidence,null,2));
  }finally{
    fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(evidence,null,2));
    await browser?.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
