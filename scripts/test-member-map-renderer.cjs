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
  '@vis.gl/react-google-maps': `import React from 'react'; export const useMapsLibrary=()=>({Size:class{constructor(w,h){this.width=w;this.height=h}}}); export const APILoadingStatus={LOADED:'loaded',FAILED:'failed',AUTH_FAILURE:'auth_failure'}; export const APIProvider=({children,apiKey})=>{window.fixture.providerKey=apiKey;return children}; export const useApiLoadingStatus=()=>window.fixture.status; export const Map=({children})=>React.createElement('div',{'data-testid':'google-map'},children); export const Marker=({title,onClick,position})=>React.createElement('button',{'aria-label':title,onClick,'data-lat':position.lat,'data-lng':position.lng},title);`,
  'solito/navigation': `export const useRouter=()=>({push:p=>window.fixture.route=p});`,
  '@dvnt/app/features/settings/ui/LocationControls': `import React from 'react';export const LocationControls=({allowSharing})=>React.createElement('button',{'aria-label':'Synthetic sharing toggle',onClick:()=>{window.fixture.sharing=false;window.renderFixture()},disabled:!allowSharing},'Stop sharing');`,
  '@dvnt/app/lib/hooks/use-member-map': `export const useLocationSettings=()=>({sharing:window.fixture.sharing});export const useMemberMapPresence=active=>{window.fixture.presenceActive=active;return{error:null,isUpdating:false,refresh:async()=>{window.fixture.refreshes++}}};export const useNearbyMembers=active=>{window.fixture.nearbyActive=active;return {data:window.fixture.data,isPending:false,isError:window.fixture.error,refetch:()=>{window.fixture.retries++}}};`,
};
async function bundle(key, native = false, expoKey = '') {
  const platformMocks = native ? {
    'react-native': `import React from 'react'; export const Platform={OS:'ios'}; const box=({children,accessibilityLabel,onPress,...props})=>React.createElement('div',{'aria-label':accessibilityLabel},children); export const View=box,Text=box,ScrollView=box,ActivityIndicator=()=>null;export const Pressable=({children,onPress,accessibilityLabel})=>React.createElement('button',{onClick:onPress,'aria-label':accessibilityLabel},children);export const Image=()=>React.createElement('span',null,'avatar');`,
    'expo-router': `export const useRouter=()=>({push:p=>window.fixture.route=p});`,
    'expo-image': `const icon={fixtureImage:true};export const useImage=()=>icon;`,
    'expo-maps': `import React from 'react';const Map=({markers=[],annotations=[],onMarkerClick,onAnnotationClick,cameraPosition})=>{window.fixture.camera=cameraPosition;return React.createElement('div',{'data-testid':'native-map'},...markers.map(m=>React.createElement('button',{key:m.id,'data-monogram':m.monogram,onClick:()=>onMarkerClick(m)},m.title)),...annotations.map(m=>React.createElement('button',{key:m.id,'data-photo':!!m.icon,onClick:()=>onAnnotationClick(m)},m.title)))};export const AppleMaps={View:Map},GoogleMaps={View:Map};`,
  } : {};
  const boundaries = {...mocks, ...platformMocks};
  return build({jsx:'automatic',tsconfigRaw:{},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import MemberMap from ${JSON.stringify(path.join(root,`packages/app/features/events/ui/member-map${native ? '' : '.web'}.tsx`))};const r=createRoot(document.getElementById('root'));window.renderFixture=()=>r.render(React.createElement(MemberMap));window.renderFixture();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY':JSON.stringify(key),'process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY':JSON.stringify(expoKey)},plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},args=>args.path==='@dvnt/ui/google-maps-public-config'?{path:path.join(root,'packages/ui/src/google-maps-public-config.ts')}:boundaries[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'jsx',resolveDir:root}));}}]});
}
(async()=>{
 const scripts={expo:(await bundle('  ',false,'  synthetic-expo-key  ')).outputFiles[0].text,configured:(await bundle('synthetic-not-a-real-key')).outputFiles[0].text,missing:(await bundle('')).outputFiles[0].text,native:(await bundle('',true)).outputFiles[0].text};
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const globals=fs.readFileSync(path.join(root,'apps/web/src/app/(frontend)/globals.css'),'utf8');
 const candidates=fs.readFileSync(path.join(root,'packages/app/features/events/ui/member-map.web.tsx'),'utf8').match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[];
 const css=(await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities important;\n'+globals.slice(globals.indexOf('/* ── Deviant brand tokens')))).build(candidates);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<style>${css}</style><body style="background:#06070d;color:white"><div id="root"></div><script>window.fixture=${JSON.stringify({status:'loaded',sharing:true,error:false,refreshes:0,retries:0,data:{members:[member],center:{latitude:40.7,longitude:-74},expiresAt:'2099-01-01T00:00:00Z'}})};</script><script>${scripts[req.url==='/expo'?'expo':req.url==='/native'?'native':req.url==='/missing'?'missing':'configured']}</script>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:393,height:852}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);await page.getByRole('button',{name:'Night Owl — approximate area'}).waitFor();
  assert.equal(await page.locator('[data-lat]').getAttribute('data-lat'),'40.71');
  for(const width of [320,393,768,1280]) {
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`People UI fits ${width}px`);
  }
  await page.setViewportSize({width:393,height:852});
  await page.screenshot({path:'/tmp/dvnt-member-map-renderer-phone.png',fullPage:true});
  await page.getByRole('button',{name:'Night Owl — approximate area'}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/profile/night%20owl');
  await page.getByRole('button',{name:'Update my location'}).click();
  assert.equal(await page.evaluate(()=>window.fixture.refreshes),1);
  await page.getByRole('button',{name:'Synthetic sharing toggle'}).click();
  assert.equal(await page.locator('[data-testid="google-map"]').count(),0,'off immediately removes all map pins');
  await page.evaluate(()=>{window.fixture.sharing=true;window.fixture.error=true;window.renderFixture()});
  await page.getByText('Nearby people could not be refreshed. Locations have been hidden.').waitFor();
  assert.equal(await page.locator('[data-lat]').count(),0);
  await page.evaluate(()=>{window.fixture.error=false;window.fixture.data.members[0].expiresAt=new Date(Date.now()+250).toISOString();window.renderFixture()});
  await page.waitForTimeout(1400);assert.equal(await page.locator('[data-lat]').count(),0,'expiry removes stale avatars without network');
  await page.evaluate(()=>{window.fixture.status='auth_failure';window.renderFixture()});
  await page.getByText('Google Maps could not load.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),false);
  await page.goto(`${url}/expo`);await page.getByRole('button',{name:'Night Owl — approximate area'}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.providerKey),'synthetic-expo-key');
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),true);
  await page.goto(`${url}/missing`);await page.getByText('The nearby people map is not available',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.presenceActive),undefined,'missing provider never mounts collection hook');
  assert.equal(await page.getByRole('button',{name:'Synthetic sharing toggle'}).isDisabled(),true);
  await page.goto(`${url}/native`);await page.locator('[data-testid="native-map"]').waitFor();
  await page.locator('[data-monogram="NO"]').waitFor();
  await page.evaluate(()=>{window.fixture.initialCamera=window.fixture.camera});
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.fixture.initialCamera===window.fixture.camera),true,'expiry clock must not reset native camera');
  await page.evaluate(()=>{window.fixture.data.members[0].avatarUrl='https://fixture.example.test/avatar.png';window.renderFixture()});
  await page.locator('[data-photo="true"]').waitFor();
  await page.locator('[data-photo="true"]').click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/night%20owl');
  await page.getByRole('button',{name:'Synthetic sharing toggle'}).click();
  assert.equal(await page.locator('[data-testid="native-map"]').count(),0);
  assert.deepEqual(errors,[]); console.log('PASS: avatar marker, profile route, explicit location button, opt-out, refresh failure, expiry, provider auth failure, no-key/no-collection; native custom avatar annotation, initials, profile and opt-out');
 }finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
