/** Chromium integration of production WEB components + real React Query.
 * Auth, location/device and API boundaries are synthetic. This is NOT a Next
 * deployment or live-backend E2E test. --build-only never launches a browser.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const { fixtures: shared, entry } = require('./test-follow-requests-dom.cjs');
const root = path.resolve(__dirname, '..');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const fixtures = { ...shared };
delete fixtures['@dvnt/app/lib/hooks/use-user-settings'];
delete fixtures['@dvnt/app/lib/stores/city-discovery-visibility'];
Object.assign(fixtures, {
  "@dvnt/app/lib/stores/events-screen-store": `export const useEventsScreenStore={getState:()=>({setSelectedMapEventId:()=>{},setShowMapView:()=>{}})};`,
  '@dvnt/app/lib/auth/identity': `import {useAuth} from 'fixture';export const getAuthIdFromStore=()=>useAuth.getState().user?.authId;export const requireBetterAuthToken=async()=> 'fixture-token';`,
  '@dvnt/app/lib/stores/ui-store': `export const useUIStore=s=>s({showToast:()=>{}});`,
  '@dvnt/app/lib/supabase/client': `import {state} from 'fixture';export const supabase={functions:{invoke:async(name,{body})=>{state.settingsCalls.push(body);if(body.action==='update'){if(state.saveFail)return {error:{message:'Save failed'}};state.savedPrivacy={...state.savedPrivacy,...body.settings.privacy};}return {data:{ok:true,data:{settings:{privacy:{...state.savedPrivacy}}}},error:null};}}};`,
  '@dvnt/app/lib/hooks/use-member-proximity': `export const useSyncMemberProximityPresence=()=>({withdrawalPending:false,stop:()=>{}});`,
  '@dvnt/app/lib/hooks/use-exact-distance-consent': `export const useExactDistanceConsent=()=>({enabled:false,busy:false,withdrawalPending:false,update:()=>{}});`,
  '@dvnt/app/lib/stores/exact-distance-store': `export const EXACT_DISTANCE_COPY='Exact distances require separate consent';`,
  '@dvnt/app/lib/stores/events-location-store': `export const useEventsLocationStore=s=>s({activeCity:null,visibilityDurationId:'1h',setVisibilityDuration:()=>{},showMeInCity:()=>{},preciseProximityGrant:false});export const useActiveCityVisibility=()=>null;`,
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:()=>null,setItem:()=>{}};`,
  '@dvnt/app/lib/hooks/use-member-map': `import {state} from 'fixture';import {useSyncExternalStore} from 'react';function tick(){useSyncExternalStore(cb=>{addEventListener('locationchange',cb);return()=>removeEventListener('locationchange',cb)},()=>state.locationVersion)}function changed(){state.locationVersion++;dispatchEvent(new Event('locationchange'))}export function useLocationSettings(){tick();return {loading:false,busy:false,error:null,sharing:state.sharing,settings:{sessionKey:state.locationSession,sessionExpiresAt:'2099-01-01T00:00:00Z'},setSharing:async value=>{state.sharing=value;state.stops++;changed();}}}export function useMapSharingConsent(){tick();return {busy:false,error:null,cancel:()=>{},share:async()=>{state.shares++;state.sharing=true;changed();return true;}}}`,
});
const source = entry + `
import {publishSessionBoundary as publishBoundary} from '@dvnt/app/lib/auth/session-lifecycle';
import {PrivacyScreen} from '@dvnt/app/features/settings/privacy.web';
import {MapSharingConsent} from '@dvnt/app/features/events/map-sharing-consent.web';
screens.privacy=PrivacyScreen;screens.location=()=> <><MapSharingConsent active promptOnly/><MapSharingConsent active/></>;
window.weekly={state,useAuth,mount,publishSessionBoundary:publishBoundary};
`;
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-web-'));let browser;
 try {
 await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{__DEV__:'true'},nodePaths:deps,outfile:path.join(dir,'web.js'),plugins:[{name:'synthetic-boundaries',setup(b){
 b.onResolve({filter:/.*/},a=>{
 let key=a.path;
 if(key.startsWith('.')) key='@dvnt/app/'+path.relative(path.join(root,'packages/app'),path.resolve(a.resolveDir,key)).replace(/\\/g,'/');
 if(fixtures[key])return {path:key,namespace:'fixture'};
 if(key.startsWith('@dvnt/app/')){const stem=path.join(root,'packages/app',key.slice(10));for(const ext of (a.importer.endsWith('.web.tsx')?['.web.tsx','','.ts','.tsx']:['','.ts','.tsx']))if(fs.existsSync(stem+ext)&&fs.statSync(stem+ext).isFile())return {path:stem+ext};}
 });b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:root}));}}]});
 if(process.argv.includes('--build-only')){console.log('PASS weekly web browser bundle builds; browser assertions NOT executed');return;}
 const {chromium}=require('playwright');browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
 await page.addScriptTag({path:path.join(dir,'web.js')});
 for (const width of [390,1280]) {
 await page.setViewportSize({width,height:844});
 const reset=async screen=>page.evaluate(screen=>{
 const f=window.weekly;f.app?.unmount();document.getElementById('root').replaceChildren();
 Object.assign(f.state,{calls:[],reads:[],navigations:[],pending:false,fail:false,loadFail:false,loadHold:false,statusHold:false,statusFail:false,releases:[],readReleases:[],statusReleases:[],requests:{'owner-a':[{follower_id:2,created_at:'2026-11-09T00:00:00Z',requester:{username:'First'}}]},statuses:{},statusReads:0,overlayResets:0,postReads:[],postResponses:{},postHold:false,postReleases:[],gateCalls:[],gateCallbacks:[],verification:{state:'approved'},admission:{state:'allowed',reason:'verified'},verificationError:false,admissionError:false,settingsCalls:[],savedPrivacy:{privateAccount:false,activityStatus:true,readReceipts:true,showLikes:true},saveFail:false,locationVersion:0,locationSession:String(Math.random()),sharing:false,shares:0,stops:0});
 f.publishSessionBoundary({ready:true,authId:'auth-a'});f.useAuth.setState({user:{id:'owner-a',authId:'auth-a',username:'Owner'},isAuthenticated:true});f.app=f.mount(document.getElementById('root'));f.app.render(screen);
 },screen);
 const button=name=>page.getByRole('button',{name,exact:true});
 // Real privacy screen and real settings hooks persist through a fresh QueryClient.
 await reset('privacy');const privateRadio=page.getByRole('radio',{name:'Private',exact:true});
 await privateRadio.waitFor();await privateRadio.click();
 await page.waitForFunction(()=>document.querySelector('[role=radio][aria-checked=true]')?.textContent==='Private');
 assert.equal(await page.evaluate(()=>window.weekly.state.savedPrivacy.privateAccount),true);
 await page.evaluate(()=>{const f=window.weekly;f.app.unmount();f.app=f.mount(document.getElementById('root'));f.app.render('privacy');});
 await page.waitForFunction(()=>document.querySelector('[role=radio][aria-checked=true]')?.textContent==='Private');
 await page.evaluate(()=>window.weekly.state.saveFail=true);await page.getByRole('radio',{name:'Public',exact:true}).click();
 await page.getByText('Could not save visibility. Please try again.',{exact:true}).waitFor();assert.equal(await privateRadio.getAttribute('aria-checked'),'true');
 // Actual web requests panel: approval pending lock, completion, empty-state refresh.
 await reset('web');await page.evaluate(()=>window.weekly.state.pending=true);
 await button("Approve First's follow request").click();
 await page.waitForFunction(()=>window.weekly.state.calls.length===1);
 // React Query notifies observers asynchronously after entering the API stub.
 // Await the committed pending UI, then require every action to stay locked
 // until the deliberately held server response is released.
 await page.getByText('Approving request…',{exact:true}).waitFor();
 assert.equal(await button("Approve First's follow request").getAttribute('aria-busy'),'true');
 assert.equal(await button("Approve First's follow request").isDisabled(),true);
 assert.equal(await button("Decline First's follow request").isDisabled(),true);
 assert.equal(await button('Refresh follow requests').isDisabled(),true);
 await page.evaluate(()=>window.weekly.state.releases.splice(0).forEach(r=>r()));
 await page.getByText('Request approved.',{exact:false}).waitFor();
 await button('Refresh follow requests').click();
 // Gate's real status observer invalidates real Query caches. Synthetic server
 // projections must grant access separately; approval alone never unlocks data.
 await reset('web-feed');await button('Request to FOLLOW').first().waitFor();
 await page.evaluate(()=>{const f=window.weekly;f.state.statuses['owner-a']={following:false,followRequestStatus:'pending'};return f.app.client.invalidateQueries({queryKey:['follow-request-status']});});
 await button('Cancel follow request').first().waitFor();await button('Cancel follow request').first().click();await button('Cancel follow request').first().click();
 assert.equal(await page.evaluate(()=>window.weekly.state.gateCalls.length),1);
 assert.equal(await page.evaluate(()=>window.weekly.state.gateCalls.at(-1).variables.action),'unfollow');
 await page.evaluate(()=>window.weekly.state.statusFail=true);
 await button('Check request status').first().click();await button('Retry follow status').first().waitFor();
 await page.evaluate(()=>window.weekly.state.statusFail=false);
 await button('Retry follow status').first().click();await button('Check request status').first().waitFor();
 await page.evaluate(()=>{const f=window.weekly;f.state.gateCallbacks.splice(0).forEach(r=>r());f.state.statuses['owner-a']={following:true,followRequestStatus:'approved'};f.state.postHold=true;f.state.postResponses['owner-a']={isSpicyLocked:false,caption:'PERMITTED_SYNTHETIC_POST'};});
 await button('Check request status').first().click();
 await page.getByText('Checking post access…',{exact:true}).waitFor();
 assert.equal(await page.getByText('PERMITTED_SYNTHETIC_POST',{exact:true}).count(),0);
 await page.evaluate(()=>{const f=window.weekly;f.state.postHold=false;f.state.postReleases.splice(0).forEach(r=>r());});
 await page.getByText('PERMITTED_SYNTHETIC_POST',{exact:true}).waitFor();
 // Observer mounted on profile continues checking after the unlocked gate disappears.
 await page.evaluate(()=>{const f=window.weekly;f.app.render('web-status');});
 await page.waitForFunction(()=>window.weekly.app.client.getQueryCache().findAll({queryKey:['follow-request-status']}).some(q=>q.state.data?.following===true&&q.state.fetchStatus==='idle'));
 const resetsBeforeRevoke=await page.evaluate(()=>window.weekly.state.overlayResets);
 await page.evaluate(()=>{const f=window.weekly;f.state.statuses['owner-a']={following:false,followRequestStatus:'none'};f.state.postResponses['owner-a']={isSpicyLocked:true};});
 await page.evaluate(()=>window.weekly.app.client.invalidateQueries({queryKey:['follow-request-status']}));
 await page.waitForFunction(before=>window.weekly.state.overlayResets>before,resetsBeforeRevoke);
 await page.evaluate(()=>window.weekly.app.render('web-feed'));
 await button('Request to FOLLOW').first().waitFor();assert.equal(await page.getByText('PERMITTED_SYNTHETIC_POST',{exact:true}).count(),0);
 await page.evaluate(()=>{const f=window.weekly;f.publishSessionBoundary({ready:true,authId:'auth-b'});f.useAuth.setState({user:{id:'owner-b',authId:'auth-b',username:'Other'},isAuthenticated:true});});
 await page.waitForFunction(()=>window.weekly.state.postReads.filter(r=>r.owner==='owner-b').length===2);
 await button('Request to FOLLOW').first().waitFor();
 assert.equal(await page.getByText('PERMITTED_SYNTHETIC_POST',{exact:true}).count(),0);
 // Native HTML dialog, keyboard dismissal, disclosure, explicit consent and stop.
 await reset('location');await page.getByRole('dialog').waitFor();
 assert.equal(await button('Not now').evaluate(el=>el===document.activeElement),true);
 assert.equal(await page.evaluate(()=>window.weekly.state.shares),0);
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await button('Show my avatar').click();await page.getByRole('dialog').waitFor();
 await button('Share my location').click();await button('Stop sharing').waitFor();
 assert.equal(await page.evaluate(()=>window.weekly.state.shares),1);
 await button('Stop sharing').click();await button('Show my avatar').waitFor();
 assert.equal(await page.evaluate(()=>window.weekly.state.stops),1);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium production web privacy save/remount/failure, request approval/pending, cancel dispatch, status refresh/protected projections/revocation, HTML location disclosure/Escape/explicit share/stop. API/auth/device synthetic; no deployed Next/backend E2E or CSS geometry claim.');
 }finally{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
