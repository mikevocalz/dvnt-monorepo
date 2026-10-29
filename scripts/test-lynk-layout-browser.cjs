#!/usr/bin/env node
/**
 * Rendered layout regression, using the production room, panels, stage, stores,
 * native dock and glass layout. Only account/server/media/native-device boundaries
 * are fixtures. No account, camera, microphone or live endpoint is accessed.
 *
 * Run: node scripts/test-lynk-layout-browser.cjs
 * CI: install the Playwright-managed Chromium with `playwright install chromium`.
 * NODE_PATH can point at a separate fixture dependency installation.
 * --build-only validates the source graph and generated Tailwind, NOT geometry.
 * --smoke additionally mounts React in happy-dom, NOT a browser geometry pass.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const source = (relative) => path.join(ROOT, relative);
const dependencyPaths = [ROOT, source('apps/web'), ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = (name) => require.resolve(name, { paths: dependencyPaths });
const load = (name) => require(resolve(name));
const nodePaths = [...new Set(dependencyPaths.flatMap((p) => [p, path.join(p, 'node_modules')]))];
const lynk = 'packages/app/features/sneaky-lynk/';

const fixture = `
  import { create } from 'zustand';
  const params = new URLSearchParams(location.search);
  export const noop = () => {};
  export const localUser = { id:'fixture-host', authId:'fixture-auth', username:'Local Host', displayName:'Local Host', avatar:'', isVerified:true };
  const defaults = { role:params.get('role') || 'host', publishers:2, listeners:0, hasVideo:true, overlayOpen:false,
    insets:{top:0,right:0,bottom:0,left:0}, reactions:[], connection:'connected', rosterState:params.get('roster') || 'ready' };
  export const useFixture = create(() => ({...defaults}));
  export const f = window.fixture = { actions:[], toasts:[], failActions:[], routes:[], sent:[], attachments:[], nativeMounts:[], roster:[], membersSync:null, membersError:null, commentsSync:null };
  const names = index => 'Participant ' + String(index).padStart(2,'0');
  function roster() {
    const c = useFixture.getState();
    return [{userId:localUser.id,role:c.role,status:'active',handRaised:false,displayName:localUser.displayName},
      ...Array.from({length:c.publishers-1},(_,i)=>({userId:'publisher-'+String(i+1).padStart(2,'0'),role:'participant',status:'active',handRaised:false,displayName:names(i+1)})),
      ...Array.from({length:c.listeners},(_,i)=>({userId:'listener-'+i,role:'listener',status:'active',handRaised:i<3,displayName:'Listener '+i}))];
  }
  f.deliverRoster = () => {
    const state=useFixture.getState().rosterState;
    if(state==='ready')f.membersSync?.(f.roster);
    else if(state==='error')f.membersError?.(new Error('fixture roster unavailable'));
  };
  f.configure = patch => { useFixture.setState(patch); f.roster=roster(); f.deliverRoster(); };
  f.configure({});
  export const attachCanvas = (peer, element) => { f.attachments.push({peer, attached:!!element}); };
  const mediaActions = { goLive:async()=>{}, end:noop, setMicEnabled:value=>f.actions.push('mic:'+value), setCameraEnabled:value=>f.actions.push('camera:'+value), attachCanvas };
  export function useLynkBroadcast() {
    const c=useFixture();
    return { ...mediaActions, state:'live', isLive:true, error:null, micEnabled:false,cameraEnabled:false,cameraActive:false,
      localStream:null,localAudioStream:null,coPublishers:f.roster.filter(m=>m.role!=='listener' && m.userId!==localUser.id).map(m=>({peerId:m.userId,path:'fixture/'+m.userId,videoAvailable:c.hasVideo})) };
  }
  const moderationResult = (action, userId) => {
    f.actions.push(action+':'+userId);
    return f.failActions.includes(action) ? {ok:false,error:{message:'Fixture permission changed'}} : {ok:true};
  };
  export const videoApi = {
    subscribeToMembers:(_id,_change,options)=> {f.membersSync=options.onSync;f.membersError=options.onError;queueMicrotask(()=>f.deliverRoster());return()=>{f.membersSync=null;f.membersError=null}},
    subscribeToRoomEvents:()=>noop,
    muteAll:async()=>{f.actions.push('muteAll');return {ok:true}},unmuteAll:async()=>{f.actions.push('unmuteAll');return {ok:true}},mutePeer:async({targetUserId})=>moderationResult('mute',targetUserId),unmutePeer:async({targetUserId})=>moderationResult('unmute',targetUserId),
    promotePeer:async()=>({ok:true}),demotePeer:async()=>({ok:true}),kickUser:async({targetUserId})=>moderationResult('kick',targetUserId),changeRole:async({targetUserId,newRole})=>moderationResult(newRole,targetUserId)
  };
  // The production timer only renders during the final minute. Keep a real
  // server deadline in that window so host header geometry includes the badge.
  export const sneakyLynkApi = { joinRoom:async()=>({ok:true,data:{peer:{role:useFixture.getState().role},user:localUser,room:{id:'fixture-room',title:'A very long Lynk title that must not push host controls outside the phone',hasVideo:true,endsAt:new Date(Date.now()+55000).toISOString()}}}),
    endRoom:async()=>{f.actions.push('endRoom');return {ok:true}},leaveRoom:async()=>{f.actions.push('leaveRoom');return {ok:true}},toggleHand:async()=>({ok:true}) };
  const comments = Array.from({length:30},(_,i)=>({id:i+1,roomId:'fixture-room',authorId:'publisher-1',body:'Earlier message '+i+' with enough text to wrap on a narrow phone.',parentId:null,rootId:null,depth:0,mentions:[],createdAt:new Date(1700000000000+i).toISOString(),author:{displayName:'Participant 01',username:'Participant 01',avatar:''}}));
  export const subscribeToRoomComments=(_id,_new,options)=>{f.commentsSync=options.onSync;queueMicrotask(()=>f.commentsSync?.(comments));return()=>{f.commentsSync=null}};
  export const postRoomComment=async(params)=>{f.sent.push(params.body);return {...params,id:1000+f.sent.length,createdAt:new Date().toISOString(),parentId:null,rootId:null,depth:0,mentions:[]}};
`;

const boundaries = new Map([
  ['fixture', fixture],
  ['solito/navigation', `import {f} from 'fixture';const router={push:path=>f.routes.push(path),back:()=>{}};export const useRouter=()=>router;export const useParams=()=>({id:'fixture-room'});export const useSearchParams=()=>new URLSearchParams();`],
  ['@dvnt/app/lib/stores/auth-store', `import {create} from 'zustand';import {localUser} from 'fixture';export const useAuthStore=create(()=>({user:localUser}));`],
  ['@dvnt/app/lib/stores/ui-store', `import {create} from 'zustand';import {f} from 'fixture';export const useUIStore=create(()=>({showToast:(...args)=>f.toasts.push(args)}));`],
  ['@dvnt/app/lib/lynk/useLynkBroadcast.web', `export {useLynkBroadcast} from 'fixture';`],
  ['@dvnt/app/lib/lynk/useSpeakingDetection.web', `export const useSpeakingDetection=()=>false;`],
  ['@dvnt/app/lib/lynk/useSpeakingPresence', `const empty={};export const useSpeakingPresence=()=>empty;`],
  ['@dvnt/app/lib/subscription/use-entitlements', `export const useEntitlements=()=>({entitlements:{sessionMinutes:5},isLoading:false});`],
  ['@dvnt/app/lib/hooks/use-verified-gate', `export const useVerifiedGate=()=>callback=>callback();`],
  ['@dvnt/app/features/video/api', `export {videoApi} from 'fixture';`],
  ['@dvnt/app/lib/api/events', `export const eventsApi={getEventByLynkRoom:async()=>({id:'fixture-event',title:'A long linked event title',slug:null})};`],
  ['@dvnt/observability', `export const addSentryBreadcrumb=()=>{};`],
  ['@dvnt/ui', `export {ConnectionBanner} from '${source('packages/ui/src/video/ConnectionBanner.web.tsx')}';export {RoomTimer} from '${source('packages/ui/src/video/RoomTimer.web.tsx')}';export {Dialog} from '${source('packages/ui/src/form/Dialog.web.tsx')}';`],
  ['@dvnt/app/lib/secure-capture', `export {SecureCaptureBoundary} from '${source('packages/app/lib/secure-capture/SecureCaptureBoundary.tsx')}';`],
  [source(lynk+'api/supabase'), `export {sneakyLynkApi} from 'fixture';`],
  [source(lynk+'api/comments'), `export {subscribeToRoomComments,postRoomComment} from 'fixture';`],
  [source('packages/app/features/video/api'), `export {videoApi} from 'fixture';`],
  [source(lynk+'hooks/useRoomHeartbeat'), `export const useRoomHeartbeat=()=>{};`],
  [source(lynk+'hooks/useEventLynkWaitingRoom'), `export const useEventLynkWaitingRoom=()=>{};`],
  [source(lynk+'hooks/useSneakyLynkCaptureBroadcast'), `const value={notifyLocalCapture:()=>{}};export const useSneakyLynkCaptureBroadcast=()=>value;`],
  [source('packages/app/features/video/useRoomLifecycle'), `const value={notifyEnded:()=>{}};export const useRoomLifecycle=()=>value;`],
  [source(lynk+'session/useRoomSession'), `import {useFixture} from 'fixture';export const useRoomSession=()=>({state:useFixture(s=>s.connection)});export const bannerPhaseFor=s=>s.state;`],
  [source(lynk+'stores/lynk-history-store'), `import {create} from 'zustand';export const useLynkHistoryStore=create(()=>({endRoom:()=>{}}));`],
  [source(lynk+'hooks/useRoomReactions'), `import {useFixture,f} from 'fixture';export const useRoomReactions=()=>({reactions:useFixture(s=>s.reactions),sendReaction:emoji=>f.actions.push('reaction:'+emoji)});`],
  [source('packages/app/lib/secure-capture/useSecureCaptureGuard'), `export const shouldEnableWebSecureCapture=()=>true;export const useSecureCaptureGuard=()=>({blackoutReason:null});`],
  ['react-native-safe-area-context', `import {useFixture} from 'fixture';export const useSafeAreaInsets=()=>useFixture(s=>s.insets);`],
  ['expo-haptics', `export const impactAsync=async()=>{};export const notificationAsync=async()=>{};export const ImpactFeedbackStyle={Light:'light',Medium:'medium'};export const NotificationFeedbackType={Warning:'warning'};`],
  ['react-native-reanimated', `import {View} from 'react-native';const chain={springify:()=>chain,damping:()=>chain,stiffness:()=>chain,duration:()=>chain};export const FadeInRight=chain,FadeOutRight=chain;export default {View};`],
  ['expo-blur', `import {View} from 'react-native';export function BlurView({children,style,pointerEvents}){return <View style={style} pointerEvents={pointerEvents}>{children}</View>}`],
  ['@dvnt/app/lib/safe-native-modules', `export {View as SafeLiquidGlassView} from 'react-native';export const safeIsLiquidGlassSupported=false;`],
  // Native geometry fixtures intentionally have no broadcasts. Playback is
  // tested separately by test-lynk-native-playback-ownership.cjs.
  ['react-native-moq', `export function useVideoPlayer(){throw new Error('Native playback is outside this geometry adapter');}`],
  ['native-media-tile', `
    import {useEffect} from 'react';import {View,Text} from 'react-native';import {f} from 'fixture';
    export function VideoTile({participant,tileWidth,tileHeight}) {
      useEffect(()=>{f.nativeMounts.push({id:participant.id,mounted:true});return()=>f.nativeMounts.push({id:participant.id,mounted:false})},[participant.id]);
      return <View testID={'native-tile-'+participant.id} style={{width:tileWidth,height:tileHeight,backgroundColor:'#152131',alignItems:'center',justifyContent:'center'}}>
        <Text style={{color:'white',fontSize:12}}>{participant.user.displayName}</Text>
      </View>;
    }
  `],
]);

async function buildFixture() {
  const esbuild = load('esbuild');
  const bundle = await esbuild.build({
    stdin: { resolveDir:ROOT, loader:'tsx', contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {RoomInner} from './${lynk}screens/room.web';
      import {StageTile} from './${lynk}ui/web/room-stage';
      import {ControlsBar} from './${lynk}ui/ControlsBar';
      import {RoomStage as NativeRoomStage} from './${lynk}ui/RoomStage';
      import {useSneakyLynkCaptureStore} from '@dvnt/app/lib/stores/sneaky-lynk-capture-store';
      import {useRoomUIStore} from './${lynk}stores/room-ui-store';
      import {useFixture,f,localUser} from 'fixture';
      f.expireSession=()=>useRoomUIStore.getState().setShowTimeUp(true);
      useSneakyLynkCaptureStore.getState().setWebPeerPresent(true);
      const portrait=document.createElement('canvas');portrait.width=180;portrait.height=320;
      const paint=()=>{const ctx=portrait.getContext('2d');ctx.fillStyle='#21b981';ctx.fillRect(0,0,180,320);ctx.fillStyle='#ef4444';ctx.fillRect(0,0,20,320);ctx.fillStyle='#3b82f6';ctx.fillRect(160,0,20,320);};if(location.search.includes('rail=fill'))paint();
      const preview=location.search.includes('rail=fill') ? portrait.captureStream?.(10) : undefined;
      const attachFill=(_path,canvas)=>{if(canvas){canvas.width=180;canvas.height=320;canvas.getContext('2d').drawImage(portrait,0,0);f.attachments.push({peer:'fill',attached:true});}};
      const fillTile={key:'remote',name:'Portrait caller',isHost:false,isCoHost:false,isLocal:false,isCameraOn:true,isMicOn:true,canvasPath:'fill/portrait',attachCanvas:attachFill};
      function App(){const c=useFixture();const action=name=>()=>f.actions.push(name);
        if(location.search.includes('rail=fill'))return <div style={{height:'100dvh',display:'grid',gridTemplateRows:'1fr 1fr',gap:8,padding:8,background:'#06070d'}}><StageTile tile={{...fillTile,key:'local',isLocal:true,canvasPath:undefined,videoStream:preview}}/><StageTile tile={{...fillTile,isCameraOn:c.hasVideo}}/></div>;
        return location.search.includes('rail=native') ? <div data-native-room style={{position:'fixed',inset:0,background:'#06070d',display:'flex',flexDirection:'column'}}>
          <div data-native-header style={{height:96+c.insets.top,paddingTop:c.insets.top,flexShrink:0,color:'white'}}>Native room header</div>
          <NativeRoomStage participants={f.roster.map(member=>({id:member.userId,user:{id:member.userId,displayName:member.displayName},role:member.role,isLocal:member.userId===localUser.id,isCameraOn:c.hasVideo,isMicOn:false}))}
            activeSpeakers={new Set()} isHost={c.role==='host'} hostUserId={localUser.id}/>
          <ControlsBar isMuted hasVideo={c.hasVideo} isVideoEnabled={c.hasVideo} handRaised={false} localRole={c.role}
            overlayOpen={c.overlayOpen} floatingReactions={c.reactions} onLeave={action('leave')} onToggleMute={action('mute')}
            onToggleVideo={action('video')} onToggleHand={action('hand')} onOpenChat={()=>f.configure({overlayOpen:true})}
            onShare={action('share')} onSwitchCamera={action('flip')} onSendReaction={emoji=>f.actions.push('reaction:'+emoji)} onReport={action('report')}/>
          </div> : <RoomInner id="fixture-room" roomHasVideo={c.hasVideo} isCreator={c.role==='host'}/>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    `},
    bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic',
    tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},
    nodePaths, resolveExtensions:['.web.tsx','.web.ts','.tsx','.ts','.jsx','.js','.json'],
    define:{'process.env.NODE_ENV':'"test"','process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION':'"true"','__DEV__':'false'},
    plugins:[{name:'room-service-boundaries',setup(build){
      build.onResolve({filter:/.*/},args=>{
        if(args.path==='./VideoGrid'&&args.importer===source(lynk+'ui/RoomStage.tsx'))return {path:'native-media-tile',namespace:'fixture'};
        const absolute = args.path.startsWith('.') ? path.resolve(args.resolveDir,args.path) : args.path;
        const key=boundaries.has(args.path)?args.path:boundaries.has(absolute)?absolute:null;
        if(key)return {path:key,namespace:'fixture'};
        if(args.path==='react-native')return {path:resolve('react-native-web')};
        if(args.path==='lucide-react-native')return {path:resolve('lucide-react')};
        if(args.path.startsWith('@dvnt/app/'))return build.resolve(source('packages/app/'+args.path.slice('@dvnt/app/'.length)),{resolveDir:ROOT,kind:args.kind});
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:ROOT,contents:boundaries.get(args.path)}));
      build.onLoad({filter:/screens\/room\.web\.tsx$/},args=>({loader:'tsx',resolveDir:path.dirname(args.path),contents:fs.readFileSync(args.path,'utf8')+'\nexport { RoomInner };\n'}));
    }}],
  });
  // Match the production layered theme/preflight and important utilities.
  // Explicit sources ensure the exact production class strings are compiled.
  const twRoot = path.dirname(resolve('tailwindcss/package.json'));
  const cssInput = `@import "${twRoot}/theme.css" layer(theme);\n@import "${twRoot}/preflight.css" layer(base);\n@import "${twRoot}/utilities.css" important;\n@source "${source('packages/app/features/sneaky-lynk')}";\n@source "${source('packages/app/lib/secure-capture')}";\n@source "${source('packages/ui/src/video')}";\n@source "${source('packages/ui/src/form')}";`;
  const css = await load('postcss')([load('@tailwindcss/postcss')({base:ROOT})]).process(cssInput,{from:source('lynk-layout-fixture.css')});
  assert.match(css.css,/\.flex\s*\{/,'Tailwind must generate actual room utilities');
  assert.match(css.css,/safe-area-inset-bottom/,'safe-area CSS must be present');
  assert.match(bundle.outputFiles[0].text,/data-room-phase/,'actual room screen must be bundled');
  return {js:bundle.outputFiles[0].text,css:css.css};
}

const allCases = [
  {name:'narrow-short-phone',width:320,height:480},
  {name:'small-phone',width:320,height:568},
  {name:'phone-375',width:375,height:667},
  {name:'chrome-phone-393',width:393,height:640},
  {name:'notched-phone',width:390,height:844,insets:{top:47,bottom:34,left:0,right:0}},
  {name:'landscape-667',width:667,height:375,insets:{top:0,bottom:21,left:44,right:44}},
  {name:'landscape-844',width:844,height:390,insets:{top:0,bottom:21,left:47,right:47}},
  {name:'tablet-portrait',width:768,height:1024,insets:{top:24,bottom:20,left:0,right:0}},
  {name:'tablet-landscape',width:1024,height:768,insets:{top:24,bottom:20,left:0,right:0}},
  {name:'desktop',width:1440,height:900},
];
const cases = process.env.LYNK_LAYOUT_CASES ? allCases.filter(c=>process.env.LYNK_LAYOUT_CASES.split(',').includes(c.name)) : allCases;
const zeroInsets = {top:0,right:0,bottom:0,left:0};
const tick = (page) => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const failures=[];
function recordFailure(name,error) {
  failures.push({name,message:String(error.message||error)});
  console.error('FAIL '+name+'\n'+String(error.stack||error));
}

async function dimensions(locator) {
  return locator.evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label')||el.textContent.trim(),x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}));
}
function assertContained(rects, bounds, context) {
  assert.ok(rects.length,context+': expected rendered targets');
  for(const r of rects) {
    assert.ok(r.width>0&&r.height>0,`${context}: ${r.label} has no rendered area`);
    assert.ok(r.x>=bounds.left-1&&r.right<=bounds.right+1&&r.y>=bounds.top-1&&r.bottom<=bounds.bottom+1,
      `${context}: ${r.label} is outside ${JSON.stringify(bounds)}: ${JSON.stringify(r)}`);
  }
}
function assertNoOverlap(rects, context) {
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++) {
    const a=rects[i],b=rects[j];
    assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,
      `${context}: ${a.label} overlaps ${b.label}`);
  }
}
async function assertReachable(locator, context) {
  const covered=await locator.evaluateAll(nodes=>nodes.filter(el=>{
    const r=el.getBoundingClientRect(), top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return !top || (top!==el&&!el.contains(top));
  }).map(el=>el.getAttribute('aria-label')||el.textContent.trim()));
  assert.deepEqual(covered,[],context+': controls must receive taps');
}
async function assertFullyVisibleCard(locator, context) {
  const result=await locator.evaluate(card=>{
    const r=card.getBoundingClientRect();
    const clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
    for(let parent=card.parentElement;parent;parent=parent.parentElement) {
      const style=getComputedStyle(parent),p=parent.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,p.left);clip.right=Math.min(clip.right,p.right)}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,p.top);clip.bottom=Math.min(clip.bottom,p.bottom)}
    }
    const visible=r.left>=clip.left-1&&r.right<=clip.right+1&&r.top>=clip.top-1&&r.bottom<=clip.bottom+1;
    // Check the picture and the focus control: a sticky hero may cover a card
    // even though both its DOM node and bounding box are present.
    const covered=[0.15,0.5,0.85].flatMap(x=>[0.15,0.5,0.85].map(y=>{
      const hit=document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);
      return !hit || (hit!==card&&!card.contains(hit));
    })).some(Boolean);
    return {visible,covered,clip,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}};
  });
  assert.ok(result.visible&&!result.covered,context+': full thumbnail must be visible and unobscured '+JSON.stringify(result));
}
async function evidence(page,name,error) {
  if(!process.env.LYNK_LAYOUT_OUTPUT)return;
  const directory=path.resolve(process.env.LYNK_LAYOUT_OUTPUT);fs.mkdirSync(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,name+'.png')}).catch(()=>{});
  if(error) {
    fs.writeFileSync(path.join(directory,name+'.txt'),String(error.stack||error));
    const geometry=await page.evaluate(()=>({
      viewport:{width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height,offsetTop:visualViewport?.offsetTop},
      nodes:[...document.querySelectorAll('[data-room-viewport],[data-room-viewport]>*,#anticapture-wrapper,[data-secure-capture-boundary],main,[data-room-content],[data-room-content]>header,footer,[data-stage-scroll],[data-stage-card],[role="dialog"],[data-native-room]>*,[data-testid="lynk-native-stage"],[data-testid="lynk-native-focus"],[data-testid="lynk-native-participants"]')].map(el=>{
        const r=el.getBoundingClientRect(),s=getComputedStyle(el);
        return {tag:el.tagName,id:el.id,classes:el.getAttribute('class'),testId:el.getAttribute('data-testid'),card:el.getAttribute('data-stage-card'),
          x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,
          style:{position:s.position,display:s.display,height:s.height,minHeight:s.minHeight,overflow:s.overflow,padding:s.padding,flex:s.flex}};
      })
    })).catch(()=>null);
    fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(geometry,null,2));
  }
}
async function assertWebGeometry(page, c, visible={top:0,height:c.height},checkHeader=true) {
  const insets={...zeroInsets,...c.insets};
  const bounds={left:insets.left,right:c.width-insets.right,top:visible.top+insets.top,bottom:visible.top+visible.height-insets.bottom};
  const dock=page.locator('main[data-room-phase] > footer');
  const buttons=dock.locator('button:visible');
  const controls=await dimensions(buttons);
  assertContained(controls,bounds,c.name+' web dock');
  assertNoOverlap(controls,c.name+' web dock');
  await assertReachable(buttons,c.name+' web dock');
  if(checkHeader) {
    const header=page.locator('[data-room-content] > header');
    const headerTargets=await dimensions(header.locator('button:visible,[role="timer"]:visible'));
    assertContained(headerTargets,bounds,c.name+' header');
    assertNoOverlap(headerTargets,c.name+' header');
    assertNoOverlap(await dimensions(header.locator(':scope > button,:scope > div,:scope > span')),c.name+' header title and control regions');
    await assertReachable(header.locator('button:visible'),c.name+' header');
    const [back]=await dimensions(header.getByRole('button',{name:'Back',exact:true}));
    const [identity]=await dimensions(header.locator('[data-room-header-title]'));
    const [actions]=await dimensions(header.locator('[data-room-header-actions]'));
    assert.ok(Math.abs(back.y+back.height/2-(identity.y+identity.height/2))<=1,c.name+': title stays in the same header row as Back');
    assert.ok(Math.abs(back.y-actions.y)<=1&&Math.abs(back.height-actions.height)<=1,c.name+': Share/actions stay on the same single 44px header row');
    assert.ok(identity.height<=44,c.name+': identity/timer do not create another header row');
    assert.ok(actions.x>=identity.right-1,c.name+': actions stay to the right of the title');
    assert.equal(await header.locator('[data-room-header-title]').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,c.name+': title, timer and event must fit their grid column');
  }
  const [footerRect]=await dimensions(dock);
  for(const region of await dimensions(page.locator('[data-room-content]'))) {
    assert.ok(region.bottom<=footerRect.y+1,c.name+': content must not overlap the dock');
  }
  const viewport=await page.locator('[data-room-viewport]').boundingBox();
  assert.ok(viewport,c.name+': room owns a viewport wrapper');
  assert.ok(Math.abs(viewport.y-visible.top)<=1&&Math.abs(viewport.height-visible.height)<=1,
    c.name+': room must follow the visible viewport, including keyboard offsets');
}

async function setInsets(page, insets) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets});
  const actual=await page.evaluate(()=>{
    const probe=document.createElement('div');probe.style.padding='env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);const style=getComputedStyle(probe);const result=['Top','Right','Bottom','Left'].map(side=>parseFloat(style['padding'+side]));probe.remove();return result;
  });
  assert.deepEqual(actual,[insets.top,insets.right,insets.bottom,insets.left],'Chromium must really emulate CSS safe areas');
}

async function createPage(browser,url,c,role,rail='web',rosterState='ready') {
  const context=await browser.newContext({viewport:{width:c.width,height:c.height},reducedMotion:'reduce'});
  const page=await context.newPage();
  page.setDefaultTimeout(8000);
  const errors=[],unexpectedRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const target=new URL(route.request().url());
    if(target.origin===url)return route.continue();
    unexpectedRequests.push(target.origin+target.pathname);return route.abort();
  });
  await page.goto(url+'/?rail='+rail+'&role='+role+'&roster='+rosterState);
  await page.waitForFunction(()=>window.fixture);
  await setInsets(page,{...zeroInsets,...c.insets});
  if(rail==='web')await page.locator('main[data-room-phase="connected"]').waitFor();
  await page.evaluate(insets=>window.fixture.configure({insets}),{...zeroInsets,...c.insets});
  await tick(page);
  return {page,context,errors,unexpectedRequests};
}

async function webCases(browser,url) {
  for(const c of cases)for(const role of ['host','participant']) {
    const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,role);
    try {
      const privacyNotice=page.locator('[data-room-viewport] > [class*="alert-anticapture"]');
      assert.match(await privacyNotice.textContent(),/Press enter to continue/,'the real privacy notice is part of initial layout');
      await assertWebGeometry(page,c);
      if(c.insets?.top) {
        const [noticeRect]=await dimensions(privacyNotice);
        const [backRect]=await dimensions(page.getByRole('button',{name:'Back',exact:true}));
        assert.ok(Math.abs(backRect.y-noticeRect.bottom-8)<=1,c.name+': the visible notice consumes top safe area once, without a second header inset');
      }
      const mountedBeforeNoticeDismiss=await page.evaluate(()=>window.fixture.attachments.length);
      await page.keyboard.press('Enter');await privacyNotice.waitFor({state:'hidden'});await tick(page);
      await assertWebGeometry(page,c);
      if(c.insets?.top) {
        const [backRect]=await dimensions(page.getByRole('button',{name:'Back',exact:true}));
        assert.ok(Math.abs(backRect.y-c.insets.top-8)<=1,c.name+': dismissed notice restores the header top safe area');
      }
      assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mountedBeforeNoticeDismiss,'privacy notice dismissal must not remount media');
      // Exercise the production stage's distinct solo/duo layouts before
      // switching to the crowd view. No copied HTML is used for any mode.
      for(const publishers of [1,2]) {
        await page.evaluate(publishers=>window.fixture.configure({publishers}),publishers);await tick(page);
        assert.equal(await page.locator('[data-tile]').count(),publishers,c.name+' stage count');
        assert.equal(await page.locator('[data-stage-mode]').getAttribute('data-stage-mode'),publishers===1?'solo':'duo');
        const tiles=page.locator('[data-tile]');
        const sizes=await dimensions(tiles);
        if(publishers===2) {
          assert.ok(Math.abs(sizes[0].width-sizes[1].width)<=1&&Math.abs(sizes[0].height-sizes[1].height)<=1,c.name+': duo tiles must be equal-sized');
          const stacked=[...sizes].sort((a,b)=>a.y-b.y);
          assert.ok(stacked[0].bottom<=stacked[1].y,c.name+': two-person videos must stack vertically at every width, never side by side');
          assert.ok(Math.abs(stacked[0].x-stacked[1].x)<=1,c.name+': stacked videos align horizontally');
        }
        for(let index=0;index<publishers;index++) {
          await tiles.nth(index).scrollIntoViewIfNeeded();await tick(page);
          await assertFullyVisibleCard(tiles.nth(index),c.name+' '+publishers+'-person tile '+index);
        }
        await page.locator('[data-room-content]').evaluate(el=>{el.scrollTop=0});await tick(page);
        await assertWebGeometry(page,c);
      }
      await page.evaluate(()=>window.fixture.configure({publishers:12,listeners:18,reactions:Array.from({length:12},(_,i)=>({id:'r'+i,emoji:'🔥'}))}));
      await tick(page);
      await assertWebGeometry(page,c);
      assert.equal(await page.locator('footer button:visible').count(),6,'exactly six dock controls at every video viewport size');
      const reactionsToggle=page.getByRole('button',{name:'Reactions',exact:true});
      assert.equal(await reactionsToggle.count(),1,'one reaction toggle in the dock');
      assert.equal(await page.getByRole('button',{name:/^React /}).count(),0,'no permanent emoji row');
      const mountsBeforePicker=await page.evaluate(()=>window.fixture.attachments.length);
      const dockBefore=await page.locator('[data-room-controls]').boundingBox();
      await reactionsToggle.click();
      const reactionButtons=page.getByRole('button',{name:/^React /});
      assert.equal(await reactionButtons.count(),6,'all six reactions expand from the dock');
      assert.equal(await reactionsToggle.getAttribute('aria-expanded'),'true');
      const bounds={left:c.insets?.left||0,right:c.width-(c.insets?.right||0),top:c.insets?.top||0,bottom:c.height-(c.insets?.bottom||0)};
      assertContained(await dimensions(reactionButtons),bounds,c.name+' reactions');
      await assertReachable(reactionButtons,c.name+' reactions');
      assert.equal((await page.locator('[data-room-controls]').boundingBox()).height,dockBefore.height,'opening picker must not take stage/dock layout height');
      await evidence(page,'web-'+c.name+'-'+role+'-picker');
      await page.getByRole('button',{name:'React 🔥',exact:true}).click();
      await page.waitForFunction(()=>window.fixture.actions.includes('reaction:🔥'));
      assert.equal(await reactionButtons.count(),0,'selection closes picker');
      assert.equal(await reactionsToggle.getAttribute('aria-expanded'),'false');
      assert.equal(await reactionsToggle.evaluate(el=>el===document.activeElement),true,'selection returns focus to toggle');
      await reactionsToggle.click();await page.keyboard.press('Escape');
      assert.equal(await reactionButtons.count(),0,'Escape closes picker');
      assert.equal(await reactionsToggle.evaluate(el=>el===document.activeElement),true,'Escape returns focus to toggle');
      await reactionsToggle.click();await reactionsToggle.click();
      assert.equal(await reactionButtons.count(),0,'toggle closes repeatedly');
      await reactionsToggle.click();
      await page.locator('[data-room-header-title]').click();
      assert.equal(await reactionButtons.count(),0,'outside tap dismisses picker');
      assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mountsBeforePicker,'picker never remounts media');
      if(role==='host') {
        await page.getByRole('timer').waitFor();
        const more=page.getByRole('button',{name:'Room actions, 3 raised hands',exact:true});
        if(c.width<640) {
          await more.click();
          const menu=page.getByRole('group',{name:'Room actions',exact:true});
          assertContained(await dimensions(menu.locator('button')),bounds,c.name+' room actions');
          await assertReachable(menu.locator('button'),c.name+' room actions');
          await evidence(page,'web-'+c.name+'-host-actions');
          await menu.getByRole('button',{name:'Mute everyone',exact:true}).click();
          assert.equal(await menu.count(),0,'moderation selection closes overflow');
          await more.click();await menu.getByRole('button',{name:'Let everyone unmute',exact:true}).click();
          await page.waitForFunction(()=>window.fixture.actions.includes('muteAll')&&window.fixture.actions.includes('unmuteAll'));
          await more.click();await page.keyboard.press('Escape');
          assert.equal(await menu.count(),0,'Escape closes room actions');
          assert.equal(await more.evaluate(el=>el===document.activeElement),true,'Escape returns focus to More');
          await more.click();await reactionsToggle.click();
          assert.equal(await menu.count(),0,'outside tap dismisses room actions');
          await reactionsToggle.click();
          await more.click();
        }
        await page.locator('button[aria-label="3 raised hands"]:visible').click();
        const queue=page.getByRole('dialog',{name:/Raised hands/});
        await queue.waitFor();
        assert.equal(await page.getByRole('group',{name:'Room actions',exact:true}).count(),0,'queue opens after closing overflow');
        await queue.getByRole('button',{name:'Close',exact:true}).click();
        assert.equal(await page.getByRole('group',{name:'Room actions',exact:true}).count(),0,'closing queue does not resurrect overflow');
      }
      await reactionsToggle.click();
      await page.getByRole('button',{name:'Chat',exact:true}).click();
      const chat=page.getByRole('dialog',{name:'Chat',exact:true});
      await chat.waitFor();
      const chatButtons=chat.getByRole('button',{name:/^(Close|Send message)$/});
      assert.equal(await reactionButtons.count(),0,'opening chat dismisses picker');
      assertContained(await dimensions(chatButtons),bounds,c.name+' chat');
      await assertReachable(chatButtons,c.name+' chat');
      await chat.getByRole('textbox',{name:'Message',exact:true}).fill('Layout fixture message');
      await chat.getByRole('button',{name:'Send message',exact:true}).click();
      await page.waitForFunction(()=>window.fixture.sent.length===1);
      assert.equal(await chat.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'','successful send clears draft');
      await chat.getByRole('button',{name:'Close',exact:true}).click();
      await chat.waitFor({state:'detached'});
      assert.equal(await reactionButtons.count(),0,'closing chat does not resurrect picker');
      await assertWebGeometry(page,c);
      assert.deepEqual(errors,[],c.name+' runtime errors');
      assert.deepEqual(unexpectedRequests,[],c.name+' must not access live endpoints');
      await evidence(page,'web-'+c.name+'-'+role);
      console.log('PASS rendered web '+c.name+' '+role+': 1/2/12-person layouts, dock, header, listeners, reactions, chat send/close');
    } catch(error) {await evidence(page,'FAIL-web-'+c.name+'-'+role,error);recordFailure('web-'+c.name+'-'+role,error)} finally {await context.close()}
  }
}

// Exercise the production RoomInner callbacks and ParticipantsPanel, not copied
// controls. Media/account boundaries remain fixtures; this is not a live call.
async function moderationCases(browser,url) {
  for(const c of cases)for(const role of (process.env.LYNK_MODERATION_ROLES || 'host,co-host,participant,moderator').split(',')) {
    const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,role);
    try {
      await page.keyboard.press('Enter');
      await page.evaluate(role=>{
        const f=window.fixture;
        f.configure({publishers:12,listeners:0});
        f.roster[1].role=role==='host'?'co-host':'host';
        if(role==='moderator')f.roster[2].role='moderator';
        f.deliverRoster();
      },role);
      await tick(page);
      await page.getByRole('button',{name:'Participants',exact:true}).click();
      const panel=page.getByRole('dialog',{name:'In the room · 12',exact:true});
      await panel.waitFor();
      const guest='Participant 03';
      const mute=panel.getByRole('button',{name:'Mute '+guest,exact:true});
      const allowed=role!=='participant';
      assert.equal(await mute.count(),allowed?1:0,role+' individual moderation');
      assert.equal(await panel.getByRole('button',{name:'Mute Local Host',exact:true}).count(),0,'never moderate self');
      if(role!=='host')assert.equal(await panel.getByRole('button',{name:'Mute Participant 01',exact:true}).count(),0,'never moderate room host');
      assert.equal(await panel.getByRole('button',{name:'Make '+guest+' a co-host',exact:true}).count(),role==='host'?1:0,'promotion is host-only');
      assert.equal(await panel.getByRole('button',{name:'Mute everyone',exact:true}).count(),role==='host'?1:0,'bulk mute is host-only');
      if(role==='moderator')assert.equal(await panel.getByRole('button',{name:'Remove Participant 02 from the room',exact:true}).count(),0,'moderator cannot kick peer moderator');
      if(allowed) {
        for(const [name,action] of [['Mute '+guest,'mute'],['Let '+guest+' unmute','unmute'],['Remove '+guest+' from the room','kick']]) {
          const button=panel.getByRole('button',{name,exact:true});
          await button.scrollIntoViewIfNeeded();await tick(page);
          await assertReachable(button,c.name+' '+role+' '+action);
          await button.click();
          await page.waitForFunction(action=>window.fixture.actions.includes(action+':publisher-03'),action);
          await page.evaluate(action=>window.fixture.failActions=[action],action);
          await button.click();
          await page.waitForFunction(()=>window.fixture.toasts.some(t=>t[0]==='error'&&t[2]==='Fixture permission changed'));
          await page.evaluate(()=>{window.fixture.failActions=[];window.fixture.toasts=[]});
        }
      }
      if(role==='host') {
        await panel.getByRole('button',{name:'Make '+guest+' a co-host',exact:true}).click();
        await panel.getByRole('button',{name:'Remove co-host from Participant 01',exact:true}).click();
        await page.waitForFunction(()=>window.fixture.actions.includes('co-host:publisher-03')&&window.fixture.actions.includes('participant:publisher-01'));
      }
      await evidence(page,'moderation-'+c.name+'-'+role);
      // Realtime role changes must remove and restore controls with the panel open.
      await page.evaluate(()=>{const f=window.fixture;f.roster[0].role='participant';f.deliverRoster()});await tick(page);
      assert.equal(await panel.getByRole('button',{name:'Mute '+guest,exact:true}).count(),0,'demotion removes controls immediately');
      assert.equal(await page.locator('[data-tile="local"]').getByText('Co-host',{exact:true}).count(),0,'demotion removes stale local cohost badge');
      await page.evaluate(()=>{const f=window.fixture;f.roster[0].role='co-host';f.deliverRoster()});await tick(page);
      assert.equal(await panel.getByRole('button',{name:'Mute '+guest,exact:true}).count(),1,'promotion restores per-peer controls');
      if(role!=='host')assert.equal(await page.locator('[data-tile="local"]').getByText('Co-host',{exact:true}).count(),1,'promotion updates local cohost badge');
      assert.equal(await panel.getByRole('button',{name:'Make '+guest+' a co-host',exact:true}).count(),0,'cohost promotion does not grant host controls');
      await panel.getByRole('button',{name:'Close',exact:true}).click();
      await page.getByRole('button',{name:'Participants',exact:true}).click();
      await panel.waitFor();
      assert.equal(await panel.getByRole('button',{name:'Mute '+guest,exact:true}).count(),1,'reopen preserves current role');
      await page.evaluate(()=>{const f=window.fixture;f.roster[0].status='left';f.deliverRoster()});await tick(page);
      assert.equal(await page.getByRole('button',{name:'Mute '+guest,exact:true}).count(),0,'inactive actor has no controls');
      assert.deepEqual(errors,[],role+' moderation runtime errors');
      assert.deepEqual(unexpectedRequests,[],role+' no live endpoints');
      console.log('PASS production moderation '+c.name+' '+role+': 12 members, callbacks, failure feedback, role changes, close/reopen');
    } catch(error) {await evidence(page,'FAIL-moderation-'+c.name+'-'+role,error);recordFailure('moderation-'+c.name+'-'+role,error)} finally {await context.close()}
  }
}

async function fillCases(browser,url) {
  for(const c of cases) {
    const context=await browser.newContext({viewport:{width:c.width,height:c.height}});
    const page=await context.newPage();
    try {
      await page.goto(url+'?rail=fill');
      await page.locator('[data-tile="local"] video').waitFor();await tick(page);
      for(const selector of ['[data-tile="local"] video','[data-tile="remote"] canvas']) {
        assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).objectFit),'cover','portrait media must fill rather than pillarbox');
        const box=await page.locator(selector).boundingBox();const tile=await page.locator(selector.split(' ')[0]).boundingBox();
        assert.ok(Math.abs(box.width-tile.width)<3&&Math.abs(box.height-tile.height)<3,'media box fills tile');
      }
      const mounts=await page.evaluate(()=>window.fixture.attachments.length);
      for(let rotation=90;rotation<=360;rotation+=90) {
        await page.getByRole('button',{name:"Rotate Portrait caller's video clockwise"}).click();await tick(page);
        const box=await page.locator('[data-tile="remote"] canvas').boundingBox();const tile=await page.locator('[data-tile="remote"]').boundingBox();
        assert.ok(Math.abs(box.width-tile.width)<3&&Math.abs(box.height-tile.height)<3,'rotated cover fills same tile');
        assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mounts,'rotation never rebuilds media');
      }
      for(let interruption=0;interruption<3;interruption++) {
        await page.evaluate(()=>window.fixture.configure({hasVideo:false}));await tick(page);
        assert.equal(await page.locator('[data-tile="remote"] canvas').evaluate(el=>getComputedStyle(el).opacity),'0','unavailable video reveals avatar');
        await page.evaluate(()=>window.fixture.configure({hasVideo:true}));await tick(page);
        assert.equal(await page.locator('[data-tile="remote"] canvas').evaluate(el=>getComputedStyle(el).opacity),'1','available video returns');
        assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mounts,'fallback preserves decoder and audio subscription');
      }
      await page.setViewportSize({width:c.height,height:c.width});await tick(page);
      const resized=await page.locator('[data-tile="remote"] canvas').boundingBox();const resizedTile=await page.locator('[data-tile="remote"]').boundingBox();
      assert.ok(Math.abs(resized.width-resizedTile.width)<3&&Math.abs(resized.height-resizedTile.height)<3,'viewport rotation stays filled');
      assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mounts,'viewport rotation never rebuilds media');
      await evidence(page,'fill-'+c.name);
      console.log('PASS portrait local video and remote canvas cover '+c.name+' with stable quarter turns');
    } catch(error){recordFailure('fill-'+c.name,error)}finally{await context.close()}
  }
}

async function timeUpCases(browser,url) {
  for(const c of cases) {
    const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,'host');
    try {
      const insets={...zeroInsets,...c.insets};
      const bounds={left:insets.left,right:c.width-insets.right,top:insets.top,bottom:c.height-insets.bottom};
      // Enter through the real UI store; both buttons exercise production room
      // handlers. Only billing navigation and server end calls are recorded.
      await page.evaluate(()=>window.fixture.expireSession());
      const dialog=page.getByRole('dialog',{name:'Session time limit',exact:true});
      await dialog.waitFor();
      const upgrade=dialog.getByRole('button',{name:'Upgrade plan',exact:true});
      await upgrade.scrollIntoViewIfNeeded();await tick(page);
      assertContained(await dimensions(upgrade),bounds,c.name+' time-limit upgrade');
      await assertReachable(upgrade,c.name+' time-limit upgrade');
      await upgrade.click();
      await page.waitForFunction(()=>window.fixture.routes.includes('/feed/sneaky-lynk/billing'));
      await dialog.waitFor({state:'detached'});
      await page.evaluate(()=>window.fixture.expireSession());await dialog.waitFor();
      const leave=dialog.getByRole('button',{name:'Leave Lynk',exact:true});
      await leave.scrollIntoViewIfNeeded();await tick(page);
      assertContained(await dimensions(leave),bounds,c.name+' time-limit leave');
      await assertReachable(leave,c.name+' time-limit leave');
      await evidence(page,'time-limit-'+c.name);
      await leave.click();
      await page.waitForFunction(()=>window.fixture.actions.includes('endRoom')&&window.fixture.routes.includes('/feed/messages'));
      assert.deepEqual(errors,[],c.name+' time-limit runtime errors');
      assert.deepEqual(unexpectedRequests,[],c.name+' time-limit must not access live endpoints');
      console.log('PASS time-limit dialog '+c.name+': scroll-safe upgrade and leave actions');
    } catch(error) {await evidence(page,'FAIL-time-limit-'+c.name,error);recordFailure('time-limit-'+c.name,error)} finally {await context.close()}
  }
}

async function rosterNoticeCases(browser,url) {
  for(const c of cases.filter(c=>['narrow-short-phone','landscape-667'].includes(c.name))) {
  for(const state of ['pending','error']) {
    const name='roster-'+state+'-'+c.name;
    const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,'participant','web',state);
    try {
      const notice=page.getByTestId('lynk-roster-pending');
      await notice.waitFor();
      assert.match(await notice.textContent(),state==='error'?/Couldn't load participants/:/Connecting participants/);
      assert.equal(await page.getByText('Just you here — invite someone to join.',{exact:true}).count(),0,'unknown roster must not claim the room is empty');
      assert.equal(await page.locator('[data-stage-card="local"]').count(),1,'local preview stays mounted while roster is unknown');
      await assertWebGeometry(page,c);
      const dock=page.locator('[data-room-controls]');
      const mic=dock.getByRole('button',{name:'Unmute',exact:true});
      const camera=dock.getByRole('button',{name:'Camera on',exact:true});
      const leave=dock.getByRole('button',{name:'Leave Lynk',exact:true});
      await assertReachable(mic,name+' microphone');
      await assertReachable(camera,name+' camera');
      await assertReachable(leave,name+' leave');
      await page.evaluate(()=>{window.fixture.actions.length=0});
      await mic.click();await camera.click();
      await page.waitForFunction(()=>window.fixture.actions.includes('mic:true')&&window.fixture.actions.includes('camera:true'));
      await evidence(page,name);
      // The real hook recovers once a fresh roster arrives, then retains it
      // through a subsequent service error without re-showing the initial notice.
      await page.evaluate(()=>window.fixture.configure({rosterState:'ready'}));
      await notice.waitFor({state:'hidden'});await tick(page);
      const tileCount=await page.locator('[data-tile]').count();
      assert.equal(tileCount,2,'recovery must render the local and roster-identified remote participant');
      const remote=page.locator('[data-tile]').filter({hasText:'Participant 01'});
      assert.equal(await remote.count(),1,'remote tile must retain its roster display identity');
      const mounts=await page.evaluate(()=>window.fixture.attachments.length);
      assert.ok(await page.evaluate(()=>window.fixture.attachments.some(entry=>entry.attached)),'recovery must attach a real remote media canvas');
      await page.evaluate(()=>window.fixture.configure({rosterState:'error'}));await tick(page);
      assert.equal(await notice.count(),0,'later failures must not restore initial-loading UI');
      assert.equal(await page.locator('[data-tile]').count(),tileCount,'last good roster must remain visible');
      assert.equal(await remote.count(),1,'later failure must preserve the remote roster display identity');
      assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mounts,'transient roster errors preserve media mounts');
      await assertWebGeometry(page,c);
      await page.evaluate(()=>window.fixture.configure({rosterState:'ready',publishers:1}));
      await page.getByText('Just you here — invite someone to join.',{exact:true}).waitFor();
      await assertWebGeometry(page,c);
      await leave.click();
      await page.waitForFunction(()=>window.fixture.actions.includes('leaveRoom')&&window.fixture.routes.includes('/feed/messages'));
      assert.deepEqual(errors,[],name+' runtime errors');
      assert.deepEqual(unexpectedRequests,[],name+' must not access live endpoints');
      console.log('PASS '+name+': reachable camera/mic/leave, recovery and retained roster');
    } catch(error) {await evidence(page,'FAIL-'+name,error);recordFailure(name,error)} finally {await context.close()}
  }
  }
}

async function keyboardCase(browser,url) {
  const c={name:'keyboard-pan',width:390,height:844,insets:{top:0,right:0,bottom:0,left:0}};
  const {page,context,errors}=await createPage(browser,url,c,'host');
  try {
    // A software keyboard can shrink/pan visualViewport without changing CSS
    // dvh or window.innerHeight. Use the real viewport event handlers.
    // initScript supplies the mock before the production effect subscribes.
    await page.addInitScript(()=>{
      const vv=new EventTarget();Object.assign(vv,{height:window.innerHeight,width:window.innerWidth,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});
      window.setFixtureViewport=patch=>{Object.assign(vv,patch);vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'))};
    });
    await page.reload();
    await page.locator('main[data-room-phase="connected"]').waitFor();
    await tick(page);
    const privacyNotice=page.locator('[data-room-viewport] > [class*="alert-anticapture"]');
    const initialNoticeHeight=(await privacyNotice.boundingBox()).height;
    const mediaMounts=await page.evaluate(()=>window.fixture.attachments.length);
    await assertWebGeometry(page,c);
    await page.keyboard.press('Enter');await privacyNotice.waitFor({state:'hidden'});
    // Drive the installed privacy library's own warning state. Its wrapped
    // message must take space away from content without pushing the dock out.
    await page.keyboard.down('F12');await tick(page);await page.keyboard.up('F12');
    await privacyNotice.waitFor({state:'visible'});
    assert.match(await privacyNotice.textContent(),/prohibited from being copied or captured/);
    // Exercise user-enlarged text independently of the notice's normal font.
    // Preserve the real message, DOM and events; only increase its font size.
    await privacyNotice.evaluate(el=>el.style.setProperty('font-size','20px','important'));await tick(page);
    assert.ok((await privacyNotice.boundingBox()).height>initialNoticeHeight,'capture warning must exercise a multiline notice');
    const noticeLines=await privacyNotice.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.querySelector('p'));return range.getClientRects().length});
    assert.ok(noticeLines>=2,'enlarged privacy warning must actually wrap across multiple lines');
    await page.evaluate(()=>window.setFixtureViewport({height:310,offsetTop:70}));await tick(page);
    await assertWebGeometry(page,c,{top:70,height:310});
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mediaMounts,'multiline notice and keyboard resize preserve media mounts');
    await page.getByRole('button',{name:'Chat',exact:true}).click();
    const chat=page.getByRole('dialog',{name:'Chat',exact:true});
    await page.evaluate(()=>window.setFixtureViewport({height:310,offsetTop:70}));await tick(page);
    const targets=page.getByRole('dialog',{name:'Chat',exact:true}).locator('button[aria-label="Close"],button[aria-label="Send message"],input');
    assertContained(await dimensions(targets),{left:0,right:390,top:70,bottom:380},'keyboard chat');
    await assertReachable(targets,'keyboard chat');
    await chat.getByRole('textbox',{name:'Message',exact:true}).fill('Keyboard remains usable');
    await chat.getByRole('button',{name:'Send message',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.sent.length===1);
    await chat.getByRole('button',{name:'Close',exact:true}).click();
    await assertWebGeometry(page,c,{top:70,height:310});
    await page.evaluate(()=>window.setFixtureViewport({offsetTop:110}));await tick(page);
    await assertWebGeometry(page,c,{top:110,height:310});
    await page.evaluate(()=>window.setFixtureViewport({height:844,offsetTop:0}));await tick(page);
    await assertWebGeometry(page,c);
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mediaMounts,'notice, chat and keyboard resize/scroll never detach media');
    assert.deepEqual(errors,[]);
    await evidence(page,'web-keyboard-restored');
    console.log('PASS keyboard visualViewport resize, scroll offset, send, close and restore');
  } catch(error) {await evidence(page,'FAIL-keyboard',error);recordFailure('keyboard',error)} finally {await context.close()}
}

async function browserChromeCase(browser,url) {
  // The supplied iPhone Chrome screenshot has much less visible content height
  // than the layout viewport. Exercise the production visualViewport listener,
  // with browser chrome opening/closing independently of window.innerHeight.
  const c={name:'chrome-toolbar',width:393,height:852};
  const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,'host');
  try {
    await page.addInitScript(()=>{
      const vv=new EventTarget();Object.assign(vv,{height:640,width:393,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{configurable:true,value:vv});
      window.setFixtureViewport=patch=>{Object.assign(vv,patch);vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'))};
      Object.defineProperty(navigator,'share',{configurable:true,value:async()=>window.fixture.actions.push('share')});
    });
    await page.reload();await page.locator('main[data-room-phase="connected"]').waitFor();await tick(page);
    const mediaMounts=await page.evaluate(()=>window.fixture.attachments.length);
    for(const height of [640,730,560,640]) {
      await page.evaluate(height=>window.setFixtureViewport({height}),height);await tick(page);
      await assertWebGeometry(page,c,{top:0,height});
      const bounds={left:0,right:c.width,top:0,bottom:height};
      await page.getByRole('button',{name:'Reactions',exact:true}).click();
      const reactions=page.getByRole('button',{name:/^React /});
      assertContained(await dimensions(reactions),bounds,'Chrome toolbar reactions');await assertReachable(reactions,'Chrome toolbar reactions');
      await evidence(page,'web-chrome-toolbar-'+height+'-picker');
      await page.getByRole('button',{name:'React ❤️',exact:true}).click();
      await page.getByRole('button',{name:'Room actions',exact:true}).click();
      const menu=page.getByRole('group',{name:'Room actions',exact:true});
      assertContained(await dimensions(menu.locator('button')),bounds,'Chrome toolbar host actions');await assertReachable(menu.locator('button'),'Chrome toolbar host actions');
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'Share invite link',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.actions.includes('share'));
    assert.ok(!await page.evaluate(()=>window.fixture.actions.includes('endRoom')),'sharing must not leave/end the room');
    await page.getByRole('button',{name:'Reactions',exact:true}).click();
    await page.getByRole('button',{name:'Participants',exact:true}).click();
    const participants=page.getByRole('dialog',{name:/In the room/});await participants.waitFor();
    assert.equal(await page.getByRole('group',{name:'Choose a reaction',exact:true}).count(),0,'participants panel closes picker');
    await participants.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.getByRole('group',{name:'Choose a reaction',exact:true}).count(),0,'closing participants leaves picker closed');
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),mediaMounts,'browser chrome, menus and panels preserve canvas ownership');
    assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
    await evidence(page,'web-chrome-toolbar-restored');
    console.log('PASS screenshot-like Chrome visualViewport: 393×852 layout / 560–730px visible, single header row, picker, Share, participants and stable media');
  } catch(error) {await evidence(page,'FAIL-browser-chrome',error);recordFailure('browser-chrome',error)} finally {await context.close()}
}

async function groupStageCase(browser,url) {
  for(const viewport of cases) {
  const c={...viewport,name:'large-room-'+viewport.name};
  const {page,context,errors}=await createPage(browser,url,c,'host');
  try {
    await page.evaluate(()=>window.fixture.configure({publishers:20,listeners:12}));await tick(page);
    assert.equal(await page.locator('[data-tile]').count(),20,'every publisher must have one tile');
    await assertWebGeometry(page,c);
    assert.match(await page.locator('[data-room-listeners] > p').textContent(),/^Listeners · 12/,'audience row must be labelled as listeners');
    if(c.width>=600&&c.height<=500) {
      const initialFocus=page.locator('[data-stage-card][data-focused="true"]');
      await assertFullyVisibleCard(initialFocus,c.name+' initial landscape focus without scrolling');
      const [picture]=await dimensions(initialFocus.locator('[data-tile]'));
      const focusButton=initialFocus.getByRole('button',{name:/^Focus /});
      const [focusControl]=await dimensions(focusButton);
      assert.ok(picture.height>=80,c.name+': initial focused picture must remain at least 80px high');
      assert.ok(focusControl.height>=44,c.name+': initial focus target must remain at least 44px high');
      await assertReachable(focusButton,c.name+' initial landscape focus');
    }
    await evidence(page,'web-'+c.name+'-initial');
    const count=await page.evaluate(()=>window.fixture.attachments.length);
    assert.ok(count>=19,'real remote canvas refs must be mounted before checking media stability');
    const gallery=page.locator('[data-stage-scroll]');
    const pageCount=Number(await gallery.getAttribute('data-stage-pages'));
    assert.ok(pageCount>1,'large rooms use multiple guest pages');
    assert.equal(await gallery.evaluate(el=>getComputedStyle(el).overflowX),'auto','the gallery pages horizontally');
    assert.equal(await gallery.evaluate(el=>getComputedStyle(el).overflowY),'hidden','the guest gallery is not a vertical feed');
    const hiddenGuestButton=page.locator('[data-guest-page="1"] button').first();
    await hiddenGuestButton.evaluate(el=>el.focus());
    assert.equal(await hiddenGuestButton.evaluate(el=>el===document.activeElement),false,'inactive gallery pages are inert to keyboard focus');
    await page.getByRole('button',{name:'Next guest page',exact:true}).click();await tick(page);
    assert.equal(await gallery.getAttribute('data-stage-page'),'1','next page advances the guest gallery');
    const [galleryBox]=await dimensions(gallery);
    const [fixedHost]=await dimensions(page.locator('[data-stage-card][data-focused="true"]'));
    assert.ok(fixedHost.x>=galleryBox.x-1&&fixedHost.right<=galleryBox.right+1,'the host stays horizontally fixed while guest pages move');
    await gallery.focus();await page.keyboard.press('ArrowLeft');await tick(page);
    assert.equal(await gallery.getAttribute('data-stage-page'),'0','keyboard can return to the first guest page');
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),count,'guest paging keeps every media canvas mounted');
    const lastCard=page.locator('[data-stage-card="publisher-19"]');
    const last=page.getByRole('button',{name:'Focus Participant 19',exact:true});
    await lastCard.scrollIntoViewIfNeeded();await tick(page);
    await assertFullyVisibleCard(lastCard,c.name+' last participant');
    await evidence(page,'web-'+c.name+'-last-participant');
    await assertReachable(last,c.name+' last participant');await last.click();await tick(page);
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),count,'scrolling/focusing cannot detach or recreate video canvases');
    await assertWebGeometry(page,c,{top:0,height:c.height},false);
    const focused=page.locator('[data-stage-card="publisher-19"][data-focused="true"]');
    assert.equal(await focused.count(),1,'clicked participant becomes focused');
    await assertFullyVisibleCard(focused,c.name+' newly focused participant');
    await evidence(page,'web-'+c.name+'-focused-participant');
    // Pinning exposes Reset focus, which must not steal enough height to trap
    // another thumbnail underneath the sticky featured participant.
    const nextCard=page.locator('[data-stage-card="publisher-18"]');
    await nextCard.scrollIntoViewIfNeeded();await tick(page);
    await assertFullyVisibleCard(nextCard,c.name+' participant after pinning');
    await assertReachable(page.getByRole('button',{name:'Focus Participant 18',exact:true}),c.name+' focus after pinning');
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),count,'browsing after pinning must preserve media mounts');
    // Re-clicking the already pinned participant does not change its React
    // state key. It must still reveal the full picture after outer scrolling.
    await last.click();await tick(page);
    await assertFullyVisibleCard(focused,c.name+' refocused same participant');
    assert.equal(await page.evaluate(()=>window.fixture.attachments.length),count,'refocusing the same publisher preserves media mounts');
    await nextCard.scrollIntoViewIfNeeded();await tick(page);
    await page.evaluate(()=>window.fixture.configure({publishers:19}));await tick(page);
    assert.equal(await page.locator('[data-tile]').count(),19,'departed publisher is removed');
    assert.equal(await page.locator('[data-stage-card="local"][data-focused="true"]').count(),1,'departed focus falls back to the host');
    await assertFullyVisibleCard(page.locator('[data-stage-card="local"][data-focused="true"]'),c.name+' fallback focus after departure');
    await page.evaluate(()=>window.fixture.configure({publishers:20}));await tick(page);
    assert.equal(await page.locator('[data-tile]').count(),20,'new participant joins without duplicates');
    // Leave from the last guest page all the way back to a two-person call.
    // The survivor remains mounted and the gallery must not retain blank pages.
    await gallery.evaluate(el=>{el.scrollLeft=el.scrollWidth;el.dispatchEvent(new Event('scroll'))});await tick(page);
    await page.evaluate(()=>window.fixture.configure({publishers:2,listeners:0}));await tick(page);
    assert.equal(await gallery.getAttribute('data-stage-pages'),'1');
    assert.equal(await gallery.getAttribute('data-stage-page'),'0');
    assert.equal(await gallery.evaluate(el=>el.scrollLeft),0,'departed final pages reset the scroll offset');
    const duo=await dimensions(page.locator('[data-stage-card]'));
    assert.ok(duo[0].bottom<=duo[1].y,'group-to-duo transition restores the vertical stack');
    await page.evaluate(()=>window.fixture.configure({publishers:20,listeners:12}));await tick(page);
    // A separate default-view capture avoids presenting the intentional
    // roster-browsing scroll position as the room's initial composition.
    await page.locator('[data-room-content]').evaluate(el=>{el.scrollTop=0});await tick(page);
    await assertWebGeometry(page,c,{top:0,height:c.height},false);
    assert.deepEqual(errors,[]);
    await evidence(page,'web-'+c.name);
    console.log('PASS 20-person rendered stage '+c.name+': full last tile visible, focus, stable canvas mounts, leave fallback, rejoin');
  } catch(error) {await evidence(page,'FAIL-'+c.name,error);recordFailure(c.name,error)} finally {await context.close()}
  }
}

async function nativeCases(browser,url) {
  for(const c of cases) {
    const {page,context,errors,unexpectedRequests}=await createPage(browser,url,c,'participant','native');
    try {
      for(const publishers of [1,2,12,20]) {
        await page.evaluate(publishers=>window.fixture.configure({publishers}),publishers);await tick(page);
        assert.equal(await page.locator('[data-testid^="native-tile-"]').count(),publishers,c.name+' real native stage count');
      }
      const stage=page.getByTestId('lynk-native-stage');
      const dock=page.locator('[data-native-room] > :last-child');
      const [stageRect]=await dimensions(stage),[dockRect]=await dimensions(dock);
      assert.ok(stageRect.height>0&&stageRect.bottom<=dockRect.y+1,c.name+': measured native stage stays above dock');
      const nativeMounts=await page.evaluate(()=>window.fixture.nativeMounts.length);
      assert.ok(nativeMounts>=20,'real native stage must mount every media boundary');
      const last=page.getByTestId('native-tile-publisher-19');
      await last.scrollIntoViewIfNeeded();await tick(page);
      await assertFullyVisibleCard(last,c.name+' native last participant');
      assert.equal(await page.evaluate(()=>window.fixture.nativeMounts.length),nativeMounts,'native crowd scrolling must not remount media tiles');
      const buttons=page.locator('[data-native-room] [role="button"]');
      const insets={...zeroInsets,...c.insets};
      const bounds={left:insets.left,right:c.width-insets.right,top:insets.top,bottom:c.height-insets.bottom};
      const rects=await dimensions(buttons);
      assertContained(rects,bounds,c.name+' native dock');assertNoOverlap(rects,c.name+' native dock');await assertReachable(buttons,c.name+' native dock');
      assert.ok(rects.length>=8,'full video dock and secondary actions are covered');
      await page.getByRole('button',{name:'Open reactions',exact:true}).click();await tick(page);
      const reactions=page.locator('[data-native-room]').getByText('😂',{exact:true});
      assertContained(await dimensions(reactions),bounds,c.name+' reaction palette');await reactions.click();
      await page.waitForFunction(()=>window.fixture.actions.includes('reaction:😂'));
      await page.getByRole('button',{name:'Open chat',exact:true}).click();
      // accessibilityElementsHidden is native-only. RNW still exposes the
      // actual dock's interaction/animation styles for this geometry fixture.
      await page.waitForFunction(()=>{
        const dock=document.querySelector('[data-native-room] > :last-child');
        return dock&&getComputedStyle(dock).pointerEvents==='none'&&Number(getComputedStyle(dock).opacity)===0;
      });
      await page.evaluate(()=>window.fixture.configure({overlayOpen:false,hasVideo:false}));
      await page.waitForTimeout(250);await tick(page);
      assertContained(await dimensions(buttons),bounds,c.name+' native audio dock');
      assertNoOverlap(await dimensions(buttons),c.name+' native audio dock');
      await assertReachable(buttons,c.name+' native audio dock');
      assert.deepEqual(errors,[],c.name+' native runtime errors');
      assert.deepEqual(unexpectedRequests,[],c.name+' native must not access live endpoints');
      await evidence(page,'native-'+c.name);
      console.log('PASS actual native stage+dock via RNW '+c.name+': 1/2/12/20 participants, last tile, stable mounts, video/audio, safe areas, reactions, overlay restore');
    } catch(error) {await evidence(page,'FAIL-native-'+c.name,error);recordFailure('native-'+c.name,error)} finally {await context.close()}
  }
}

async function main() {
  const assets=await buildFixture();
  if(process.argv.includes('--build-only')) {
    console.log('PASS fixture bundle and production Tailwind compilation; browser geometry was not run');return;
  }
  if(process.argv.includes('--smoke')) {
    const {Window}=load('happy-dom');
    for(const rail of ['web','native']) {
      const window=new Window({url:'http://fixture.local/?rail='+rail});
      try {
        const errors=[];window.addEventListener('error',event=>errors.push(event.error?.stack||event.message));
        // React 19's development timing hook is absent in this DOM emulator.
        window.console.timeStamp=()=>{};
        window.document.body.innerHTML='<div id="root"></div>';
        window.eval(assets.js);await new Promise(resolve=>setTimeout(resolve,350));
        assert.ok(window.fixture,rail+' fixture mounted');
        assert.ok(window.document.querySelector(rail==='web'?'main[data-room-phase="connected"]':'[data-native-room] [role="button"]'),rail+' actual component mounted: '+window.document.body.innerHTML.slice(0,1200));
        if(rail==='web')assert.ok(window.document.querySelector('[role="timer"]'),'host fixture must exercise the real final-minute timer badge');
        for(const publishers of [1,2,12,20]) {
          window.fixture.configure({publishers});await new Promise(resolve=>setTimeout(resolve,30));
          assert.equal(window.document.querySelectorAll(rail==='web'?'[data-tile]':'[data-testid^="native-tile-"]').length,publishers,rail+' rendered participant count');
        }
        if(rail==='web') {
          window.fixture.expireSession();await new Promise(resolve=>setTimeout(resolve,30));
          const dialog=window.document.querySelector('[aria-label="Session time limit"]');
          assert.ok(dialog,'actual session time-limit dialog opens');
          [...dialog.querySelectorAll('button')].find(button=>button.textContent.includes('Upgrade plan')).click();
          await new Promise(resolve=>setTimeout(resolve,30));
          assert.ok(window.fixture.routes.includes('/feed/sneaky-lynk/billing'),'real upgrade handler navigates to billing boundary');
          window.fixture.expireSession();await new Promise(resolve=>setTimeout(resolve,30));
          [...window.document.querySelector('[aria-label="Session time limit"]').querySelectorAll('button')].find(button=>button.textContent.includes('Leave Lynk')).click();
          await new Promise(resolve=>setTimeout(resolve,30));
          assert.ok(window.fixture.actions.includes('endRoom')&&window.fixture.routes.includes('/feed/messages'),'real leave handler calls server boundary and exits');
        }
        assert.deepEqual(errors,[],rail+' runtime errors');
      } finally {await window.happyDOM.close()}
    }
    console.log('PASS actual React web/native stage+dock DOM smoke, 1/2/12/20 rosters and time-limit handlers; browser geometry was not run');return;
  }
  const server=http.createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(assets.js)}
    else if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(assets.css)}
    else {res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    // Use the version-matched, Playwright-managed browser. Never fall back to a
    // system executable or change sandbox settings to circumvent a denied run.
    browser=await load('@playwright/test').chromium.launch({headless:true});
    const url='http://127.0.0.1:'+server.address().port;
    const suites={fill:fillCases,moderation:moderationCases,web:webCases,roster:rosterNoticeCases,keyboard:keyboardCase,chrome:browserChromeCase,group:groupStageCase,time:timeUpCases,native:nativeCases};
    for(const name of (process.env.LYNK_LAYOUT_SUITES||Object.keys(suites).join(',')).split(','))await suites[name](browser,url);
    assert.equal(failures.length,0,'Rendered regression failures:\n'+JSON.stringify(failures,null,2));
    console.log('PASS all rendered Lynk viewport, room and control layout regressions');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
