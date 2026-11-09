// Executes the actual notification DTO/transform and both Activity row components.
// Only persistence, platform primitives, and unrelated screen dependencies are fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
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
  // Screen-level invite cards are covered by test-lynk-cohost-invites.cjs;
  // keep this fixture focused on real event notification rows and navigation.
  '@dvnt/app/features/sneaky-lynk/ui/web/CohostInvites': 'export const PendingCohostInvites=()=>null;',
  '@dvnt/app/features/sneaky-lynk/ui/PendingCohostInvites': 'export const PendingCohostInvites=()=>null;',
  '@dvnt/app/lib/api/notifications': 'export const notificationsApiClient={formatTimeAgo:()=>"3m ago"};',
  '@dvnt/app/lib/hooks/use-notifications-query': 'export const notificationKeys={};export const useBadges=()=>({});',
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
  assert.ok(fs.existsSync(path.join(ROOT, 'apps/web/src/app/(frontend)/feed/events/[id]/page.tsx')));
  const dto = (await exportsApi.notificationsApiClient.getNotifications()).docs[0];
  assert.equal(dto.sender.displayName, 'Deviant Events');
  assert.equal(dto.sender.username, 'deviantevents');
  assert.ok(selections.find(([table, fields]) => table === 'notifications' && fields.includes('first_name') && fields.includes('last_name')));
  const build = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {ActivityRow,webRouteForActivity} from './packages/app/features/activity/activity.web';
      import {ActivityItem} from './packages/app/features/routes/screens/(protected)/(tabs)/activity';
      import {notificationToActivity,getRouteForActivity} from './packages/app/lib/hooks/use-activities-query';
      const activity=notificationToActivity(${JSON.stringify(dto)});window.routes=[];window.profiles=[];
      const props={activity,isFollowed:false,isFollowPending:false,onUserPress:u=>window.profiles.push(u),onPostPress:()=>{},onFollowBack:()=>{}};
      const navigate=route=>{window.routes.push(route);history.pushState({},'',route)};
      const profile=(username,platform)=>{window.profiles.push(username);history.pushState({},'',(platform==='web'?'/profile/':'/(protected)/profile/')+username)};
      const root=createRoot(document.getElementById('root'));
      window.render=(normal=false)=>root.render(<><section id="web"><ActivityRow {...props} onUserPress={u=>profile(u,"web")} activity={normal?{...activity,type:'like'}:activity} onActivityPress={a=>navigate(webRouteForActivity(a))}/></section><section id="native"><ActivityItem {...props} onUserPress={u=>profile(u,"native")} activity={normal?{...activity,type:'like'}:activity} onActivityPress={a=>navigate(getRouteForActivity(a))}/></section></>);window.render();`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_BUNNY_CDN_URL': '""', 'process.env.EXPO_PUBLIC_BUNNY_CDN_URL': '""' },
    plugins: [{ name: 'explicit-fixtures', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(boundaries, args.path)) return { path: args.path, namespace: 'fixture' };
        if (args.path.startsWith('@dvnt/app/')) return { path: path.join(ROOT, 'packages/app', args.path.slice('@dvnt/app/'.length)) + '.ts' };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: boundaries[args.path], loader: 'tsx', resolveDir: ROOT }));
    } }],
  });
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(build.outputFiles[0].contents); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#080910;color:white;font:16px system-ui}section{padding:20px;margin:20px;border:1px solid grey}p{padding:10px}</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/activity`);
    for (const platform of ['web', 'native']) {
      const area = page.locator(`#${platform}`);
      const expected = platform === 'web' ? '/feed/events/90' : '/(protected)/events/90';
      assert.match(await area.innerText(), /Deviant Events sent a message to attendees of MIAMI Moonlight/);
      // The row/body opens the activity; the actor name/avatar opens only
      // that actor's profile. Repeat both flows and return with Back.
      for (let repeat = 0; repeat < 2; repeat++) {
        const before = await page.evaluate(() => window.routes.length);
        const profilesBefore = await page.evaluate(() => window.profiles.length);
        await area.getByText('“Venue changed to the new Miami address.”').click();
        assert.equal(await page.evaluate(() => window.routes.at(-1)), expected);
        assert.equal(await page.evaluate(() => window.routes.length), before + 1, 'body navigates once');
        assert.equal(await page.evaluate(() => window.profiles.length), profilesBefore, 'body does not open actor profile');
        assert.equal(new URL(page.url()).pathname, expected);
        await page.goBack();
        assert.equal(new URL(page.url()).pathname, '/activity');
      }
      for (const target of [area.getByText('Deviant Events', { exact: true }), area.getByAltText('deviantevents')]) {
        for (let repeat = 0; repeat < 2; repeat++) {
          const before = await page.evaluate(() => window.routes.length);
          const profilesBefore = await page.evaluate(() => window.profiles.length);
          await target.click();
          assert.equal(await page.evaluate(() => window.profiles.at(-1)), 'deviantevents');
          assert.equal(await page.evaluate(() => window.profiles.length), profilesBefore + 1, 'actor navigates once');
          assert.equal(await page.evaluate(() => window.routes.length), before, 'actor tap must not also open event');
          assert.equal(new URL(page.url()).pathname, platform === 'web' ? '/profile/deviantevents' : '/(protected)/profile/deviantevents');
          await page.goBack();
          assert.equal(new URL(page.url()).pathname, '/activity');
        }
      }
    }
    assert.deepEqual(await page.evaluate(() => window.profiles), Array(8).fill('deviantevents'));
    await page.evaluate(() => { window.profiles = []; });
    await page.evaluate(() => window.render(true));
    for (const platform of ['web', 'native']) {
      const area = page.locator(`#${platform}`);
      assert.match(await area.innerText(), /deviantevents liked/);
      await area.getByText('deviantevents', { exact: true }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.profiles), ['deviantevents','deviantevents']);
    assert.deepEqual(errors, []);
    console.log('PASS: actual DTO preserves profile name/handle; actual web/native broadcast rows render Deviant Events; body opens event 90; actor name/avatar open only their profile; repeated taps and Back work; normal social profile taps remain unchanged.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
