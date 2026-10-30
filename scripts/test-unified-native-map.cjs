// Real native map renderer, synthetic provider/auth/API boundaries. No live GPS.
const assert = require('node:assert/strict');
const path = require('node:path');
const {build} = require('esbuild');
const {chromium} = require('playwright');
const root=path.resolve(__dirname,'..');
const member={id:'self',username:'fixture',displayName:'Fixture',avatarUrl:'https://fixture.example/avatar.png',latitude:40.71,longitude:-74.01,expiresAt:'2099-01-01T00:00:00Z'};
const event={id:1,title:'Party',image:'https://fixture.example/flyer.png'};
const row={id:1,title:'Party',visibility:'public',is_hidden:false,publish_at:null,status:'active',is_online:false,location_type:'venue',location:'Public venue',location_name:null,location_lat:33.78,location_lng:-84.41};
const mocks={
 '@shopify/react-native-skia':require('./fixtures/native-map-icon-boundary.cjs'),
 'react-native':`import React from 'react';export const Platform={OS:window.fixture.platform};const Box=({children,accessibilityLabel})=>React.createElement('div',{'aria-label':accessibilityLabel},children);export const View=Box,Text=Box,ScrollView=Box,ActivityIndicator=()=>null;export const Modal=({visible,children})=>visible?React.createElement("div",{role:"dialog"},children):null;export const Pressable=({children,onPress,accessibilityLabel,disabled})=>React.createElement('button',{onClick:onPress,'aria-label':accessibilityLabel,disabled},children);export const Image=()=>null;`,
 'expo-router':`export const useRouter=()=>({push:p=>window.fixture.route=p});`,
 'expo-image':`const icons=new Map();export const useImage=s=>{if(typeof s!=='string'||!s)throw Error('Expo useImage requires a source');if(!icons.has(s))icons.set(s,{source:s});return icons.get(s)};`,
 'expo-maps':`import React from 'react';const Map=({markers,annotations=[],onMarkerClick,onAnnotationClick,cameraPosition,properties,onCameraMove})=>{window.fixture.moveCamera=onCameraMove;window.fixture.camera=cameraPosition;window.fixture.properties=properties;return React.createElement('div',{'data-map':true},...[...markers,...annotations].map(m=>React.createElement('button',{'data-marker':m.id,'data-image':m.icon?.source,'data-lat':m.coordinates.latitude,key:m.id,onClick:()=>m.icon&&window.fixture.platform==='ios'?onAnnotationClick(m):onMarkerClick(m)},m.title)))};export const AppleMaps={View:Map},GoogleMaps={View:Map};`,
 '@tanstack/react-query':`export const useQuery=()=>({data:window.fixture.rows,isError:window.fixture.eventError,refetch:()=>{window.fixture.retries++}});`,
 '@dvnt/app/lib/api/event-map':`export const eventMapApi={getLocations:async()=>[]};`,
 '@dvnt/app/features/settings/ui/LocationControls':`import React from 'react';export const LocationControls=()=>React.createElement('button',{onClick:()=>{window.fixture.sharing=false;window.renderFixture()}},'Stop sharing');`,
 '@dvnt/app/lib/stores/events-location-store': `export const useEventsLocationStore=selector=>selector({activeCity:window.fixture?.savedCity||window.mapFixture?.savedCity||null});`,
  '@dvnt/app/lib/hooks/use-member-map':`export const useLocationSettings=()=>({sharing:window.fixture.sharing});export const useMemberMapPresence=active=>({area:window.fixture.area,refresh:()=>{window.fixture.refreshes++},isUpdating:false,error:null});export const useNearbyMembers=()=>({data:window.fixture.data,isError:window.fixture.memberError,refetch:()=>{window.fixture.retries++}});`,
};
(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import MemberMap from './packages/app/features/events/ui/member-map';const root=createRoot(document.getElementById('root'));window.renderFixture=()=>root.render(<MemberMap events={window.fixture.events} onOpenEvent={id=>window.fixture.eventRoute=id}/>);window.renderFixture();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter),plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:a.path.startsWith('@dvnt/app/')?{path:path.join(root,'packages/app',a.path.slice('@dvnt/app/'.length)+'.ts')}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'jsx',resolveDir:root}));}}]});
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox']});
 try {for(const platform of ['ios','android']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="root"></div>');await page.evaluate(f=>window.fixture=f,{platform,events:[event],rows:[row],sharing:true,refreshes:0,retries:0,data:{members:[],self:member,center:{latitude:40.71,longitude:-74.01},expiresAt:'2099-01-01T00:00:00Z'}});await page.addScriptTag({content:result.outputFiles[0].text});
  await page.locator('[data-marker="event:1"][data-image]').waitFor();await page.locator('[data-marker="member:self"][data-image]').waitFor();
  await page.waitForFunction(()=>window.fixture.iconDraws>=2);
  const clips=await page.evaluate(()=>window.fixture.iconClips);
  assert.ok(clips.some(c=>c.width===44&&c.height===44&&c.rx===4&&c.ry===4&&c.antialias),'avatar raster clips rounded-sm');
  assert.ok(clips.some(c=>c.width===44&&c.height===58&&c.rx===4&&c.ry===4&&c.antialias),'event raster clips rounded-sm');
  for(const marker of ['member:self','event:1']) {
   const uri=await page.locator(`[data-marker="${marker}"]`).getAttribute('data-image');
   assert.ok(uri.startsWith('data:image/png;base64,'),'provider receives rounded raster, not unrounded network source');
   const pixels=await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {corner:ctx.getImageData(0,0,1,1).data[3],center:ctx.getImageData(22,22,1,1).data[3],edge:ctx.getImageData(5,0,1,1).data[3]};},uri);
   assert.equal(pixels.corner,0,'rounded corner is actually transparent');assert.equal(pixels.center,255);assert.equal(pixels.edge,255,'small radius does not become circle');
  }
  assert.equal(await page.locator('[data-map]').count(),1);assert.equal(await page.locator('[data-marker="member:self"]').innerText(),'You · approximate area');
  assert.equal(await page.locator('[data-marker="member:self"]').getAttribute('data-lat'),'40.71');
  assert.deepEqual(await page.evaluate(()=>window.fixture.properties),{isMyLocationEnabled:false,showsUserLocation:false});
  assert.deepEqual(await page.evaluate(()=>window.fixture.camera),{coordinates:{latitude:40.71,longitude:-74.01},zoom:12},'fresh own coarse center outranks the first Atlanta venue');
  await page.evaluate(()=>{window.fixture.savedData=window.fixture.data;window.fixture.data={members:[],self:null,center:null,expiresAt:null};window.renderFixture()});
  await page.getByText('Showing a broad overview of public event locations, not your current location.').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.camera),{coordinates:{latitude:39.5,longitude:-98.35},zoom:3},'no fresh center cannot masquerade as first event location');
  assert.equal(await page.locator('[data-marker="event:1"]').count(),1,'public event remains on overview');
  assert.equal(await page.evaluate(()=>window.fixture.refreshes),0,'overview must not request location');
  assert.equal(await page.getByRole('button',{name:'Update my location'}).count(),0,'no manual location button');
  await page.evaluate(()=>{window.fixture.area={latitude:40.85,longitude:-73.9};window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.coordinates.latitude===40.85);
  assert.equal(await page.getByText('Showing a broad overview of public event locations, not your current location.').count(),0,'local-only own area is not labelled as broad overview');
  assert.equal(await page.locator('[data-marker="member:self"]').count(),0,'local centering does not invent public presence');
  await page.evaluate(()=>{window.fixture.area=null;window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.camera.zoom===3);
  await page.evaluate(()=>{window.fixture.overviewCamera=window.fixture.camera;window.fixture.rows[0].location_lat=34.05;window.fixture.rows[0].location_lng=-118.24;window.renderFixture()});
  await page.waitForFunction(()=>document.querySelector('[data-marker="event:1"]')?.getAttribute('data-lat')==='34.05');
  assert.equal(await page.evaluate(()=>window.fixture.camera===window.fixture.overviewCamera),true,'changing event venue cannot reposition the viewer overview');
  await page.locator('[data-marker="event:1"]').click();assert.equal(await page.evaluate(()=>window.fixture.eventRoute),'1','event navigation stays available without own location');
  await page.evaluate(()=>{window.fixture.data=window.fixture.savedData;window.renderFixture()});
  await page.locator('[data-marker="member:self"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixture.camera),{coordinates:{latitude:40.71,longitude:-74.01},zoom:12},'fresh own center restores local view');
  assert.equal(await page.getByText('Showing a broad overview of public event locations, not your current location.').count(),0);

  await page.locator('[data-marker="event:1"]').click();assert.equal(await page.evaluate(()=>window.fixture.eventRoute),'1');
  await page.locator('[data-marker="member:self"]').click();assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/fixture');
  const loadedPhoto=await page.locator('[data-marker="member:self"]').getAttribute('data-image');
  await page.evaluate(()=>{window.fixture.failRaster=true;window.fixture.data.self.avatarUrl='https://fixture.example/allocation-failure.png';window.renderFixture()});
  await page.locator('[data-marker="member:self"]').waitFor({state:'detached'});
  await page.getByRole('button',{name:"Open Fixture's profile",exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/fixture','raster failure keeps list navigation without passing null to Expo image loader');
  await page.evaluate(()=>{window.fixture.failRaster=false;window.fixture.data.self.avatarUrl='https://fixture.example/recovered.png';window.renderFixture()});
  await page.waitForFunction(expected=>document.querySelector('[data-marker="member:self"]')?.getAttribute('data-image')===expected,loadedPhoto);

  await page.evaluate(()=>{window.fixture.data.self.avatarUrl='https://fixture.example/broken.png';window.renderFixture()});
  await page.waitForFunction(previous=>{const value=document.querySelector('[data-marker="member:self"]')?.getAttribute('data-image');return value?.startsWith('data:image/png;base64,')&&value!==previous},loadedPhoto);
  const failedPlaceholder=await page.locator('[data-marker="member:self"]').getAttribute('data-image');
  await page.evaluate(()=>{window.fixture.data.self.avatarUrl=null;window.renderFixture()});
  await page.waitForFunction(expected=>document.querySelector('[data-marker="member:self"]')?.getAttribute('data-image')===expected,failedPlaceholder);
  const fallbackPixels=await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {corner:ctx.getImageData(0,0,1,1).data[3],edge:ctx.getImageData(5,0,1,1).data[3]};},failedPlaceholder);
  assert.equal(fallbackPixels.corner,0,'no-photo/failed-photo fallback stays rounded');assert.equal(fallbackPixels.edge,255,'fallback is small-radius, not a circle');
  await page.locator('[data-marker="member:self"]').click();assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/fixture','failed image fallback keeps navigation');
  // Nearby avatars cluster by displayed proximity; same-cell members remain reachable at max zoom.
  await page.evaluate(()=>{window.fixture.data.members=[{...window.fixture.data.self,id:'peer',username:'peer',displayName:'Peer'}];window.renderFixture()});
  const cluster=page.locator('[data-marker^="cluster:"]');
  await cluster.waitFor();
  assert.equal(await page.locator('[data-marker="member:self"]').count(),0,'no obscured self under a peer');
  assert.equal(await cluster.innerText(),'2 people including you · approximate area');
  const composite=await cluster.getAttribute('data-image');
  const size=await page.evaluate(async uri=>{const image=new Image();image.src=uri;await image.decode();return [image.width,image.height]},composite);
  assert.deepEqual(size,[76,56],'cluster contains two separate rounded avatar previews and count');
  await page.evaluate(()=>window.fixture.moveCamera({zoom:22}));
  await cluster.click();
  await page.getByRole('button',{name:'View Fixture (You) profile',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/fixture');
  await cluster.click();await page.getByRole('button',{name:'View Peer profile',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixture.route),'/(protected)/profile/peer');
  await cluster.click();await page.getByRole('button',{name:'Close people cluster'}).click();
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>{window.fixture.data.members[0].longitude+=0.001;window.renderFixture()});
  await page.locator('[data-marker="member:self"]').waitFor();
  assert.equal(await cluster.count(),0,'nearby distinct coordinates split at higher zoom');
  await page.evaluate(()=>window.fixture.moveCamera({zoom:12}));await cluster.waitFor();
  await cluster.click();
  await page.evaluate(()=>{window.fixture.data.members=[];window.renderFixture()});
  await page.locator('[data-marker="member:self"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'View Peer profile',exact:true}).count(),0,'revoked member leaves open chooser immediately');
  await page.getByRole('button',{name:'Close people cluster'}).click();
  await page.evaluate(()=>{window.fixture.data.members=[{...window.fixture.data.self,id:'peer',username:'peer',displayName:'Peer'}];window.renderFixture()});
  await cluster.waitFor();await cluster.click();
  await page.getByRole('button',{name:'Stop sharing'}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  await page.evaluate(()=>{window.fixture.sharing=true;window.fixture.data.members=[];window.renderFixture()});
  await page.locator('[data-marker="member:self"]').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0,'sharing again does not reopen revoked chooser');
  await page.evaluate(()=>{window.fixture.data.self.avatarUrl='https://fixture.example/slow.png';window.renderFixture()});
  await page.evaluate(()=>window.fixture.initialCamera=window.fixture.camera);await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>window.fixture.camera===window.fixture.initialCamera),true);
  await page.getByRole('button',{name:'Stop sharing'}).click();await page.locator('[data-marker="member:self"]').waitFor({state:'detached'});assert.equal(await page.locator('[data-map]').count(),1);assert.equal(await page.locator('[data-marker="event:1"]').count(),1);
  await page.evaluate(()=>{window.fixture.sharing=true;window.fixture.memberError=true;window.renderFixture()});await page.getByText('Nearby people could not be refreshed.',{exact:false}).waitFor();assert.equal(await page.locator('[data-marker="member:self"]').count(),0);assert.equal(await page.locator('[data-marker="event:1"]').count(),1);
  assert.equal(await page.evaluate(()=>window.fixture.camera.zoom),3,'member refresh error falls back to overview, never a venue');
  await page.evaluate(()=>{window.fixture.memberError=false;window.fixture.eventError=true;window.renderFixture()});await page.locator('[data-marker="member:self"]').waitFor();assert.equal(await page.locator('[data-marker="event:1"]').count(),0);
  await page.evaluate(()=>{window.fixture.eventError=false;window.fixture.events[0].visibility='private';window.renderFixture()});await page.getByText('0 public event locations',{exact:false}).waitFor();assert.equal(await page.locator('[data-marker="event:1"]').count(),0);
  await page.evaluate(()=>{window.fixture.data.self.expiresAt=new Date(Date.now()+100).toISOString();window.renderFixture()});await page.waitForTimeout(1200);assert.equal(await page.locator('[data-marker="member:self"]').count(),0);
  await page.evaluate(()=>{window.fixture.data.expiresAt=new Date(Date.now()-1).toISOString();window.renderFixture()});
  await page.getByText('Showing a broad overview of public event locations, not your current location.').waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.camera.zoom),3,'expired viewer lease cannot retain local center');
  await page.evaluate(()=>{window.fixture.data.self.expiresAt='2099-01-01T00:00:00Z';window.fixture.data.expiresAt='2099-01-01T00:00:00Z';window.fixture.data.self.avatarUrl='https://fixture.example/slow-late.png';window.fixture.sharing=true;window.renderFixture()});
  await page.waitForFunction(()=>window.fixture.iconLoads.includes('https://fixture.example/slow-late.png'));
  await page.getByRole('button',{name:'Stop sharing'}).click();await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-marker="member:self"]').count(),0,'late image completion cannot restore opted-out member');
  assert.ok(await page.evaluate(()=>window.fixture.disposals>0),'temporary native raster resources are disposed');

  assert.deepEqual(errors,[]);await page.close();
 }console.log('PASS unified native iOS/Android: one map, event flyer/self avatar, coarse point, navigation, no precise blue dot, stable camera, opt-out, separate refresh failures, private event revocation, expiry');}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
