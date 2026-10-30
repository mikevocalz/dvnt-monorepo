// Executes the actual notification DTO/transform and both Activity row components.
// Only persistence, platform primitives, and unrelated screen dependencies are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const selections = [];
const row = {
  id: 1, type: 'event_broadcast', entity_type: 'event', entity_id: '90', actor_id: 613,
  actor: { id: 613, username: 'deviantevents', first_name: 'Deviant Events', last_name: null },
  entity_payload: { body: 'Venue changed to the new Miami address.' },
  created_at: '2026-10-12T03:57:28Z', read_at: null,
};
const db = { from(table) {
  const q = {};
  q.select = fields => { selections.push([table, fields]); return q; };
  for (const method of ['eq', 'in', 'order', 'limit']) q[method] = () => q;
  q.then = (ok, fail) => Promise.resolve({ data: table === 'notifications' ? [row] : table === 'events' ? [{ id: 90, title: 'MIAMI Moonlight' }] : [], count: 1 }).then(ok, fail);
  return q;
} };
const exportsApi = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT, 'packages/app/lib/api/notifications.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: exportsApi, console, Date, Map, Set,
  require: name => name.includes('supabase/client') ? { supabase: db }
    : name.includes('auth-helper') ? { getCurrentUserIdSync: () => 23 }
    : {},
});
const icons = ['Heart','MessageCircle','UserPlus','AtSign','Bell','BellOff','CheckCheck','Calendar','Radio','ImageOff','Megaphone'].map(name => `export const ${name}=()=>null;`).join('\n');
const boundaries = {
  'zustand': 'export const create=()=>()=>({});',
  'solito/navigation': 'export const useRouter=()=>({});',
  'expo-router': 'export const useRouter=()=>({});export const useFocusEffect=()=>{};',
  '@tanstack/react-query': 'export const useQuery=()=>({});export const useQueryClient=()=>({});',
  '@tanstack/react-virtual': 'export const useVirtualizer=()=>({});',
  'lucide-react': icons,
  'lucide-react-native': icons,
  'react-native': `import React from 'react'; const box=(tag)=>({children,onPress,numberOfLines,...p})=>React.createElement(tag,{...p,onClick:onPress ? e=>{e.stopPropagation();onPress(e)} : undefined},children);export const View=box('div'),Text=box('span'),Pressable=box('div'),ScrollView=box('div');`,
  'react-native-safe-area-context': 'export const useSafeAreaInsets=()=>({});',
  'expo-image': 'export const Image=()=>null;',
  '@dvnt/app/components/list': 'export const LegendList=()=>null;',
  '@dvnt/app/components/ui/video-thumbnail-image': 'export const VideoThumbnailImage=()=>null;',
  '@dvnt/app/components/ui/avatar': `import React from 'react';export const Avatar=({username})=><img alt={username}/>;`,
  '@dvnt/app/components/error-boundary': 'export const ErrorBoundary=()=>null;',
  '@dvnt/app/components/skeletons': 'export const ActivitySkeleton=()=>null;',
  '@dvnt/app/lib/hooks': 'export const useColorScheme=()=>({});',
  '@dvnt/app/lib/hooks/use-tab-bar-inset': 'export const useTabBarInset=()=>0;export const useTabBarTopInset=()=>0;',
  '@dvnt/app/lib/media/resolve-renderable': 'export const resolveRenderableMedia=()=>({});',
  '@dvnt/app/lib/stores/activity-store': 'export const useActivityStore=()=>({});',
  '@dvnt/app/lib/stores/auth-store': 'export const useAuthStore=()=>({});',
  '@dvnt/app/lib/hooks/use-follow': 'export const useFollow=()=>({});',
  '@dvnt/app/lib/hooks/use-bootstrap-notifications': 'export const useBootstrapNotifications=()=>({});',
  '@dvnt/app/features/sneaky-lynk/ui/web/CohostInvites': 'export const PendingCohostInvites=()=>null;',
  '@dvnt/app/lib/api/notifications': 'export const notificationsApiClient={formatTimeAgo:()=>"3m ago"};',
  '@dvnt/app/lib/hooks/use-notifications-query': 'export const notificationKeys={};',
  '@dvnt/app/lib/stores/unread-counts-store': 'export const useUnreadCountsStore=()=>({});',
  '@dvnt/app/lib/stores/ui-store': 'export const useUIStore=()=>({});',
  '@dvnt/app/lib/api/users': 'export const usersApi={};',
  '@dvnt/app/lib/events/event-lynk': 'export const roomInviteActivityText=()=>"";',
  '@dvnt/app/lib/api/events': 'export const eventsApi={};',
  '@dvnt/app/lib/api/privileged': 'export const acceptCoOrganizerInvite=()=>{};export const declineCoOrganizerInvite=()=>{};',
  '@dvnt/app/lib/routes/post-routes': 'export const navigateToPost=()=>{};export const getPostDetailRoute=id=>`/(protected)/post/${id}`;export const getPostDetailCommentsRoute=id=>`/(protected)/post/${id}/comments`;',
  '@dvnt/app/lib/prefetch': 'export const screenPrefetch=()=>{};',
  '@dvnt/app/lib/perf/stale-time-config': 'export const STALE_TIMES={};',
  '@dvnt/app/lib/query-keys': 'export const postKeys={},profileKeys={},activityKeys={};',
};

(async () => {
 const dtos=[];
 for(const type of ['ticket_comped','ticket_transfer_initiated','ticket_transfer_accepted','ticket_transfer_declined','ticket_transfer_cancelled']) {
  row.type=type;row.entity_payload={ticket_id:'00000000-0000-4000-8000-000000000001',transfer_id:'transfer-1'};
  dtos.push((await exportsApi.notificationsApiClient.getNotifications()).docs[0]);
 }
 const build=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
 import {ActivityRow,webRouteForActivity} from './packages/app/features/activity/activity.web';
 import {ActivityItem} from './packages/app/features/routes/screens/(protected)/(tabs)/activity';
 import {notificationToActivity,getRouteForActivity} from './packages/app/lib/hooks/use-activities-query';
 window.routes=[];window.profiles=[];const root=createRoot(document.getElementById('root'));
 window.renderTicket=(index)=>{const activity=notificationToActivity(${JSON.stringify(dtos)}[index]);const props={activity,isFollowed:false,isFollowPending:false,onUserPress:u=>window.profiles.push(u),onPostPress:()=>{},onFollowBack:()=>{}};
 flushSync(()=>root.render(<><section id="web"><ActivityRow {...props} onActivityPress={a=>window.routes.push(webRouteForActivity(a))}/></section><section id="native"><ActivityItem {...props} onActivityPress={a=>window.routes.push(getRouteForActivity(a))}/></section></>))};`,resolveDir:ROOT,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_BUNNY_CDN_URL':'""','process.env.EXPO_PUBLIC_BUNNY_CDN_URL':'""'},plugins:[{name:'fixtures',setup(build){
  build.onResolve({filter:/.*/},args=>{if(Object.hasOwn(boundaries,args.path))return {path:args.path,namespace:'fixture'};if(args.path.startsWith('@dvnt/app/'))return {path:path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length))+'.ts'};});
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:boundaries[args.path],loader:'tsx',resolveDir:ROOT}));
 }}]});
 const {Window}=await import(require.resolve('happy-dom'));const window=new Window({url:'https://offline.invalid',settings:{enableJavaScriptEvaluation:true}});
 try{
  window.console=console;window.document.body.innerHTML='<div id="root"></div>';window.eval(build.outputFiles[0].text);
  for(let i=0;i<dtos.length;i++){
   window.renderTicket(i);await new Promise(r=>setTimeout(r,30));
   for(const platform of ['web','native']){
    const section=window.document.querySelector('#'+platform);assert.ok(section.textContent.trim());
    const expected=i===0 ? (platform==='web'?'/feed/ticket/':'/(protected)/ticket/')+'00000000-0000-4000-8000-000000000001' : platform==='web'?'/feed/events/my-tickets':'/(protected)/events/my-tickets';
    const target=section.querySelector('[role="button"],button')||section.firstElementChild;
    for(let repeat=0;repeat<2;repeat++){const before=window.routes.length;target.click();assert.equal(window.routes.length,before+1);assert.equal(window.routes.at(-1),expected);}
   }
  }
  console.log('PASS: 5 ticket notification types through actual DTO + actual web/native rows, 20 repeated click route assertions');
 }finally{await window.happyDOM.abort();}
})().catch(e=>{console.error(e);process.exitCode=1;});
