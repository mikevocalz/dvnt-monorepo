// Real People-map renderer with synthetic auth/API/provider boundaries. No GPS,
// users, Google requests, or credentials are used by this regression suite.
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const {compile} = require('tailwindcss');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const member = {id:'fixture-1',username:'night owl',displayName:'Night Owl',avatarUrl:null,latitude:40.71,longitude:-74.01,expiresAt:'2099-01-01T00:00:00Z'};
const mocks = {
  '@dvnt/app/lib/stores/events-location-store': `export const useEventsLocationStore=selector=>selector({activeCity:window.fixture.savedCity||null});`,
  '@vis.gl/react-google-maps': require('./fixtures/member-map/google-overlay-boundary.cjs'),
  '@tanstack/react-query': `export const useQuery=()=>({data:[],isPending:false,isError:false,refetch:async()=>{}});`,
  '@dvnt/app/lib/api/event-map': `export const eventMapApi={getLocations:async()=>[]};`,
  'solito/navigation': `export const useRouter=()=>({push:p=>window.fixture.route=p});`,
  '@dvnt/app/features/settings/ui/LocationControls': `import React from 'react';export const LocationControls=({allowSharing})=>React.createElement('button',{'aria-label':'Synthetic sharing toggle',onClick:()=>{window.fixture.sharing=false;window.renderFixture()},disabled:!allowSharing},'Stop sharing');`,
  '@dvnt/app/lib/hooks/use-member-map': `export const useLocationSettings=()=>({sharing:window.fixture.sharing});export const useMemberMapPresence=active=>{window.fixture.presenceActive=active;return{area:window.fixture.area,error:null,isUpdating:false,refresh:async()=>{window.fixture.refreshes++}}};export const useNearbyMembers=active=>{window.fixture.nearbyActive=active;return {data:window.fixture.data,isPending:false,isError:window.fixture.error,refetch:()=>{window.fixture.retries++}}};`,
};
async function bundle(key, native = false, expoKey = '') {
  const platformMocks = native ? {
    'react-native': `import React from 'react'; export const Platform={OS:'ios'}; const box=({children,accessibilityLabel,onPress,...props})=>React.createElement('div',{'aria-label':accessibilityLabel},children); export const View=box,Text=box,ScrollView=box,ActivityIndicator=()=>null;export const Modal=({visible,children})=>visible?React.createElement('div',{role:'dialog'},children):null;export const Pressable=({children,onPress,accessibilityLabel})=>React.createElement('button',{onClick:onPress,'aria-label':accessibilityLabel},children);export const Image=()=>React.createElement('span',null,'avatar');`,
    'expo-router': `export const useRouter=()=>({push:p=>window.fixture.route=p});`,
    'expo-image': `const icon={fixtureImage:true};export const useImage=source=>source?icon:null;`,
    '@shopify/react-native-skia': require('./fixtures/native-map-icon-boundary.cjs'),
    'expo-maps': `import React from 'react';const Map=({markers=[],annotations=[],onMarkerClick,onAnnotationClick,cameraPosition})=>{window.fixture.camera=cameraPosition;window.fixture.nativePins=[...markers,...annotations];return React.createElement('div',{'data-testid':'native-map'},...markers.map(m=>React.createElement('button',{key:m.id,'data-monogram':m.monogram,onClick:()=>onMarkerClick(m)},m.title)),...annotations.map(m=>React.createElement('button',{key:m.id,'data-photo':!!m.icon,onClick:()=>onAnnotationClick(m)},m.title)))};export const AppleMaps={View:Map},GoogleMaps={View:Map};`,
  } : {};
  const boundaries = {...mocks, ...platformMocks};
  return build({jsx:'automatic',tsconfigRaw:{},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import MemberMap from ${JSON.stringify(path.join(root,`packages/app/features/events/ui/member-map${native ? '' : '.web'}.tsx`))};const r=createRoot(document.getElementById('root'));window.renderFixture=()=>r.render(React.createElement(MemberMap,{eventPins:window.fixture.eventPins,selectedEventId:window.fixture.selectedEventId,onSelectEvent:id=>{window.fixture.selectedEventId=id;window.renderFixture()},onOpenEvent:id=>window.fixture.eventOpened=id}));window.renderFixture();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY':JSON.stringify(key),'process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY':JSON.stringify(expoKey)},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},args=>args.path==='@dvnt/app/lib/events/event-map'?{path:path.join(root,'packages/app/lib/events/event-map.ts')}:args.path==='@dvnt/ui/google-maps-public-config'?{path:path.join(root,'packages/ui/src/google-maps-public-config.ts')}:boundaries[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'jsx',resolveDir:root}));}}]});
}
(async()=>{
 const scripts={expo:(await bundle('  ',false,'  synthetic-expo-key  ')).outputFiles[0].text,configured:(await bundle('synthetic-not-a-real-key')).outputFiles[0].text,missing:(await bundle('')).outputFiles[0].text,native:(await bundle('',true)).outputFiles[0].text};
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const globals=fs.readFileSync(path.join(root,'apps/web/src/app/(frontend)/globals.css'),'utf8');
 const candidates=(fs.readFileSync(path.join(root,'packages/app/features/events/ui/member-map.web.tsx'),'utf8')+fs.readFileSync(path.join(root,'packages/app/features/events/ui/rounded-map-marker.web.tsx'),'utf8')).match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[];
 const css=(await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities important;\n'+globals.slice(globals.indexOf('/* ── Deviant brand tokens')))).build(candidates);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<style>${css}</style><body style="background:#06070d;color:white"><div id="root"></div><script>window.fixture=${JSON.stringify({coordinateProjection:req.url==='/stack',status:'loaded',sharing:true,error:false,eventPins:[{id:'event-1',title:'Synthetic Party',latitude:40.72,longitude:-74.02,flyerUrl:'https://fixture.example.test/flyer.png'}],refreshes:0,retries:0,data:{members:[member],self:{...member,id:'self-1',username:'self',displayName:'Self',latitude:req.url==='/stack'||req.url==='/native'?40.71:40.75,longitude:req.url==='/stack'||req.url==='/native'?-74.01:-74.05},center:{latitude:40.7,longitude:-74},expiresAt:'2099-01-01T00:00:00Z'}})};</script><script>${scripts[req.url==='/expo'?'expo':req.url==='/native'?'native':req.url==='/missing'?'missing':'configured']}</script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:393,height:852}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fixture.example.test/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);await page.getByRole('button',{name:'Night Owl — approximate area'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Night Owl — approximate area'}).getAttribute('data-lat'),'40.71');
  assert.equal(await page.locator('[data-testid="google-map"]').count(),1,'one map holds events and avatars');
  assert.ok(await page.locator('[data-testid="google-map"]').evaluate(map=>Boolean(map.compareDocumentPosition(document.querySelector('[aria-label="Synthetic sharing toggle"]'))&Node.DOCUMENT_POSITION_FOLLOWING)),'location sharing controls follow the map in document and keyboard order');
  const firstMapBounds=await page.locator('[data-testid="google-map"]').boundingBox();
  const sharingBounds=await page.getByRole('button',{name:'Synthetic sharing toggle'}).boundingBox();
  assert.ok(sharingBounds.y>=firstMapBounds.y+firstMapBounds.height,'location sharing section is visually below the map');
  await page.getByRole('button',{name:'You — approximate area'}).waitFor();
  // Multiple consenting members remain available independently, including a
  // shared coarse cell. The accessible list must not collapse overlapping pins.
  await page.evaluate(()=>{const m=window.fixture.data.members[0];window.fixture.data.members.push({...m,id:'fixture-2',username:'second-peer',displayName:'Second Peer',latitude:40.78,longitude:-74.08});window.renderFixture()});
  await page.getByRole('button',{name:'Second Peer — approximate area',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Night Owl — approximate area',exact:true}).count(),1);
  await page.getByRole('list',{name:'Nearby members'}).getByRole('button',{name:/Second Peer/}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/profile/second-peer');
  await page.evaluate(()=>{window.fixture.data.members=window.fixture.data.members.filter(m=>m.id!=='fixture-2');window.renderFixture()});
  await page.getByRole('button',{name:'Second Peer — approximate area',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.fixture.zoom),12);
  await page.evaluate(()=>{window.fixture.selectedEventId='event-1';window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.lat===40.72);
  assert.equal(await page.getByRole('button',{name:'Show my area',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Update my location',exact:true}).count(),0);
  await page.evaluate(()=>{window.fixture.selectedEventId=null;window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.lat===40.7);
  await page.evaluate(()=>{window.fixture.savedCity={id:17,name:'Saved City',state:'NY',lat:42,lng:-75};window.fixture.data={members:[],self:null,center:null,expiresAt:null};window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.lat===42&&window.fixture.zoom===8);
  assert.equal(await page.getByRole('button',{name:'You — approximate area'}).count(),0,'saved city never invents an avatar');
  await page.getByText(/Showing your saved area/).waitFor();
  await page.evaluate(()=>{window.fixture.area={latitude:40.7,longitude:-74,expiresAt:'2099-01-01T00:00:00Z'};window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.lat===40.7&&window.fixture.zoom===12);
  await page.evaluate(()=>{window.fixture.area=null;window.fixture.savedCity=null;window.fixture.data={members:[{id:'fixture-1',username:'night owl',displayName:'Night Owl',avatarUrl:null,latitude:40.71,longitude:-74.01,expiresAt:'2099-01-01T00:00:00Z'}],self:{id:'self-1',username:'self',displayName:'Self',avatarUrl:null,latitude:40.75,longitude:-74.05,expiresAt:'2099-01-01T00:00:00Z'},center:{latitude:40.7,longitude:-74},expiresAt:'2099-01-01T00:00:00Z'};window.renderFixture()});
  await page.getByRole('button',{name:'You — approximate area'}).waitFor();
  await page.locator('[aria-label="Event: Synthetic Party"] img').waitFor();
  for(const label of ['Event: Synthetic Party','You — approximate area','Night Owl — approximate area']) {
    const marker=page.getByRole('button',{name:label,exact:true});
    assert.equal(await marker.evaluate(e=>getComputedStyle(e).borderRadius),'4px');
    assert.equal(await marker.evaluate(e=>getComputedStyle(e).overflow),'hidden');
  }
  await page.getByRole('button',{name:'Event: Synthetic Party'}).click();assert.equal(await page.evaluate(()=>window.fixture.eventOpened),'event-1');
  const flyer=page.getByRole('button',{name:'Event: Synthetic Party',exact:true});
  await flyer.focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.fixture.eventOpened),'event-1','keyboard opens event');
  assert.equal(await flyer.locator('img').getAttribute('referrerpolicy'),'no-referrer');
  await page.route('https://fixture.example.test/broken.png',r=>r.abort());
  await page.evaluate(()=>{window.fixture.eventPins[0].flyerUrl='https://fixture.example.test/broken.png';window.renderFixture()});
  await flyer.getByText('EVENT',{exact:true}).waitFor();
  assert.equal(await flyer.evaluate(e=>getComputedStyle(e).borderRadius),'4px','failed image keeps rounded fallback');
  await page.evaluate(()=>{window.fixture.eventPins[0].flyerUrl='https://fixture.example.test/flyer.png';window.renderFixture()});
  await flyer.locator('img').waitFor();
  await page.evaluate(()=>{window.fixture.eventPins[0].latitude=40.73;window.renderFixture()});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Event: Synthetic Party"]')?.dataset.lat==='40.73');
  assert.equal(await flyer.count(),1,'coordinate change removes previous overlay');

  for(const width of [320,393,768,1280]) {
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`People UI fits ${width}px`);
  }
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:'/tmp/dvnt-member-map-renderer-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Night Owl — approximate area'}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/profile/night%20owl');
  await page.evaluate(()=>{window.fixture.selectedEventId=null;window.renderFixture()});
  await page.getByRole('button',{name:'Synthetic sharing toggle'}).click();
  assert.equal(await page.locator('[data-testid="google-map"]').count(),1,'off keeps public event map');
  assert.equal(await page.getByRole('button',{name:'You — approximate area'}).count(),0,'off removes self');
  await page.waitForFunction(()=>window.fixture.zoom===3);
  assert.deepEqual(await page.evaluate(()=>window.fixture.camera),{lat:39.5,lng:-98.35},'no location uses broad overview, not arbitrary first event');
  await page.getByText('Showing public event locations, not events near you.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Night Owl — approximate area'}).count(),0,'off removes peers');
  await page.getByRole('button',{name:'Event: Synthetic Party'}).waitFor();
  await page.evaluate(()=>{window.fixture.area={latitude:40.85,longitude:-73.9,expiresAt:'2099-01-01T00:00:00Z'};window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.lat===40.85&&window.fixture.zoom===12);
  assert.equal(await page.getByRole('button',{name:'You — approximate area'}).count(),0,'local area does not opt into avatar sharing');
  await page.evaluate(()=>{window.fixture.area=null;window.renderFixture()});
  await page.evaluate(()=>{window.fixture.sharing=true;window.fixture.error=true;window.renderFixture()});
  await page.getByText('Nearby people could not be refreshed. Locations have been hidden.').waitFor();
  assert.equal(await page.getByRole('button',{name:/approximate area/}).count(),0);
  await page.evaluate(()=>{window.fixture.error=false;window.fixture.data.members[0].expiresAt=new Date(Date.now()+250).toISOString();window.fixture.data.self.expiresAt=new Date(Date.now()+250).toISOString();window.renderFixture()});
  await page.waitForTimeout(1400);assert.equal(await page.getByRole('button',{name:/approximate area/}).count(),0,'expiry removes stale avatars without network');
  await page.evaluate(()=>{window.fixture.status='auth_failure';window.renderFixture()});
  await page.getByText('Google Maps could not load.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),false);
  await page.goto(`${url}/expo`);await page.getByRole('button',{name:'Night Owl — approximate area'}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.providerKey),'synthetic-expo-key');
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),true);
  await page.goto(`${url}/missing`);await page.getByText('The map is unavailable',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),undefined,'missing provider never mounts collection hook');
  assert.equal(await page.getByRole('button',{name:'Synthetic sharing toggle'}).isDisabled(),true);
  // Coordinate-faithful projection: same coarse cell becomes an avatar cluster,
  // never GPS offsets or an inaccessible stack. A real chooser exposes everyone.
  await page.goto(`${url}/stack`);
  await page.route('https://fixture.example.test/portrait-*.svg',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="${route.request().url().includes('self')?'#18465d':'#60435c'}"/><circle cx="40" cy="29" r="15" fill="#e4b08a"/><path d="M10 80c0-38 60-38 60 0" fill="#d9dbed"/></svg>`}));
  await page.evaluate(()=>{window.fixture.data.self.avatarUrl='https://fixture.example.test/portrait-self.svg';window.fixture.data.members[0].avatarUrl='https://fixture.example.test/portrait-peer.svg';window.renderFixture()});
  const clusterName=n=>`${n} people in this area, including you. View people`;
  await page.getByRole('button',{name:clusterName(2),exact:true}).waitFor();
  await page.evaluate(()=>{const m=window.fixture.data.members[0];window.fixture.data.members.push({...m,id:'fixture-2',username:'second-peer',displayName:'Second Peer'});window.renderFixture()});
  const cluster=page.getByRole('button',{name:clusterName(3),exact:true});
  await cluster.waitFor();
  assert.equal(await cluster.locator('[data-preview-member]').first().getAttribute('data-preview-member'),'self-1','self preview is never hidden');
  assert.equal(await cluster.locator('[data-preview-member]').count(),2,'cluster uses avatar previews rather than count only');
  assert.equal(await cluster.innerText(),'','photo clusters show only avatars, without YOU, counts or View people');
  assert.equal(await cluster.getAttribute('title'),null,'no visible label tooltip is added to the avatar stack');
  const clusterFrame=await cluster.evaluate(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,border:style.borderTopWidth,shadow:style.boxShadow,width:element.offsetWidth,height:element.offsetHeight}});
  assert.deepEqual(clusterFrame,{background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none',width:76,height:44},'avatar stack has no purple card, container border or shadow');
  const previews=cluster.locator('[data-preview-member]');
  const selfBounds=await previews.nth(0).boundingBox(),peerBounds=await previews.nth(1).boundingBox();
  assert.ok(peerBounds.x>selfBounds.x&&peerBounds.x<selfBounds.x+selfBounds.width,'avatars overlap while both remain visible');
  assert.ok(await previews.nth(0).evaluate(element=>Number(getComputedStyle(element).zIndex)>Number(getComputedStyle(element.nextElementSibling).zIndex)),'your avatar is in front of the stack');
  assert.equal(await page.getByRole('button',{name:'You — approximate area',exact:true}).count(),0,'self belongs to cluster rather than a covered marker');
  assert.equal(await page.getByRole('button',{name:'Event: Synthetic Party',exact:true}).count(),1,'events do not enter avatar clusters');
  await cluster.focus();await page.keyboard.press('Enter');
  const chooser=page.getByRole('region',{name:'People in this area',exact:true});
  await chooser.waitFor();
  assert.equal(await chooser.getByRole('button').count(),4,'three members plus close control');
  for(const [label,route] of [['Self','/profile/self'],['Night Owl','/profile/night%20owl'],['Second Peer','/profile/second-peer']]) {
    await chooser.getByRole('button',{name:new RegExp(label)}).click();
    assert.equal(await page.evaluate(()=>window.fixture.route),route,'every clustered member navigates independently');
    if(!await chooser.isVisible())await cluster.click();
  }
  for(const width of [320,393,768,1280]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`avatar cluster chooser fits ${width}px`);
  }
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:'/tmp/dvnt-avatar-cluster-chooser-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Close people in this area',exact:true}).click();
  await chooser.waitFor({state:'detached'});
  await page.screenshot({path:'/tmp/dvnt-avatar-cluster-phone.png',fullPage:true});
  await page.evaluate(()=>window.setFixtureZoom(22));
  await cluster.waitFor();
  await cluster.click();
  await chooser.getByRole('button',{name:/Self/}).waitFor();
  assert.equal(await cluster.count(),1,'same coarse cell remains accessible even at maximum zoom');
  await page.evaluate(()=>{window.fixture.data.members=window.fixture.data.members.filter(m=>m.id!=='fixture-2');window.renderFixture()});
  await chooser.getByRole('button',{name:/Second Peer/}).waitFor({state:'detached'});
  assert.equal(await chooser.getByRole('button',{name:/Second Peer/}).count(),0,'removed users disappear from an open chooser');
  await page.getByRole('button',{name:clusterName(2),exact:true}).waitFor();
  await page.evaluate(()=>{window.fixture.data.members[0].latitude=40.7101;window.setFixtureZoom(12);window.renderFixture()});
  await page.getByRole('button',{name:clusterName(2),exact:true}).waitFor();
  await page.evaluate(()=>window.setFixtureZoom(22));
  await page.getByRole('button',{name:'Night Owl — approximate area',exact:true}).waitFor();
  await page.getByRole('button',{name:'You — approximate area',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:clusterName(2),exact:true}).count(),0,'zoom splits nearby but distinct coarse coordinates');
  await page.getByRole('button',{name:'Close people in this area',exact:true}).click();
  await chooser.waitFor({state:'detached'});
  await page.evaluate(()=>window.setFixtureZoom(12));
  await page.getByRole('button',{name:clusterName(2),exact:true}).click();
  await page.getByRole('button',{name:'Synthetic sharing toggle'}).click();
  assert.equal(await page.getByRole('button',{name:/people in this area, including you/}).count(),0,'opt-out removes cluster');
  assert.equal(await chooser.count(),0,'opt-out removes open member chooser');
  assert.equal(await page.getByRole('button',{name:'Event: Synthetic Party',exact:true}).count(),1);
  await page.goto(`${url}/native`);await page.locator('[data-testid="native-map"]').waitFor();
  await page.getByRole('button',{name:'2 people including you · approximate area',exact:true}).waitFor();
  assert.ok(await page.locator('[data-testid="native-map"]').evaluate(map=>Boolean(map.compareDocumentPosition(document.querySelector('[aria-label="Synthetic sharing toggle"]'))&Node.DOCUMENT_POSITION_FOLLOWING)),'native location controls follow the map');
  assert.equal(await page.locator('[data-monogram]').count(),0,'initials use a rounded bitmap too');
  await page.evaluate(()=>{const m=window.fixture.data.members[0];window.fixture.data.members.push({...m,id:'fixture-2',username:'second-peer',displayName:'Second Peer'});window.renderFixture()});
  await page.getByRole('button',{name:'3 people including you · approximate area',exact:true}).waitFor();
  const nativeStack=await page.evaluate(()=>window.fixture.nativePins.filter(p=>p.id.startsWith('cluster:')).map(p=>({id:p.id,coordinates:p.coordinates})));
  assert.equal(nativeStack.length,1,'native groups all colocated people into one avatar-preview pin');
  assert.ok(nativeStack.every(p=>p.coordinates.latitude===40.71&&p.coordinates.longitude===-74.01),'native forwards exactly the same coarse coordinates without spreading');
  await page.getByRole('button',{name:"Open Second Peer's profile",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/second-peer');
  await page.evaluate(()=>{window.fixture.initialCamera=window.fixture.camera});
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.fixture.initialCamera===window.fixture.camera),true,'expiry clock must not reset native camera');
  await page.evaluate(()=>{window.fixture.data.members[0].avatarUrl='https://fixture.example.test/avatar.png';window.renderFixture()});
  await page.getByRole('button',{name:'3 people including you · approximate area',exact:true}).click();
  await page.getByRole('button',{name:'View Self (You) profile',exact:true}).waitFor();
  await page.getByRole('button',{name:'View Night Owl profile',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/night%20owl');
  await page.getByRole('button',{name:'Synthetic sharing toggle'}).click();
  assert.equal(await page.locator('[data-testid="native-map"]').count(),1,'opt-out retains event map');
  assert.equal(await page.locator('[data-monogram],[data-photo]').count(),0,'opt-out removes all native member markers');
  await page.evaluate(()=>{window.fixture.savedCity={id:17,name:'Saved City',state:'NY',lat:42,lng:-75};window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.coordinates.latitude===42&&window.fixture.camera.zoom===8);
  await page.getByText(/Showing your saved area/).waitFor();
  assert.equal(await page.locator('[data-monogram],[data-photo]').count(),0,'native saved city never invents consented avatars');
  assert.deepEqual(errors,[]); console.log('PASS: avatar clusters, keyboard chooser, zoom split, exact-cell max zoom access, privacy removal; avatar marker, profile route, automatic area/no location buttons, opt-out, refresh failure, expiry, provider auth failure, no-key/no-collection; native custom avatar annotation, initials, profile and opt-out');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
