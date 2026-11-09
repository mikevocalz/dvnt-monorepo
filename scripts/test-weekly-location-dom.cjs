const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const root = path.resolve(__dirname, '..');
  const mocks = {
    '@dvnt/app/lib/stores/member-proximity-sync-store': 'export const proximityStorageError=()=>null;export const useMemberProximitySyncStore=()=>({});',
    '@dvnt/app/lib/stores/exact-distance-store': `import {useSyncExternalStore} from 'react';export const useExactDistanceStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s?s(window.fixture.exact):window.fixture.exact);useExactDistanceStore.getState=()=>window.fixture.exact;`,
    'react-native': `import React from 'react'; export const Text=({children})=><span>{children}</span>;`,
    '@dvnt/app/lib/hooks/use-member-map': 'export const useLocationSettings=()=>({});',
    '@dvnt/app/lib/stores/location-access-store': `import {useSyncExternalStore} from 'react';export const locationAllowedFor=()=>true;export const useLocationAccessStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s(window.fixture.access));useLocationAccessStore.subscribe=()=>()=>{};`,
    '@dvnt/app/lib/stores/auth-store': `import {useSyncExternalStore} from 'react';export const useAuthStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s({user:window.fixture.user}));useAuthStore.subscribe=()=>()=>{};`,
    '@dvnt/app/lib/stores/events-location-store': `import {useSyncExternalStore} from 'react';export const useEventsLocationStore=s=>useSyncExternalStore(cb=>{addEventListener('fixturechange',cb);return()=>removeEventListener('fixturechange',cb)},()=>s(window.fixture.location));`,
    '@dvnt/app/lib/hooks/use-age-verification': 'export const useVerificationState=()=>({});',
    '@dvnt/app/lib/api/member-proximity': `export const memberProximityApi={distance:async()=>{window.fixture.calls++;if(window.fixture.fail)throw Error('Unavailable');return window.fixture.reply;}};`,
  };
  const output = await build({nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemberDistanceBadge} from './packages/app/components/feed/member-distance-badge.tsx';const query=new QueryClient({defaultOptions:{queries:{retry:false}}});window.fixture.query=query;const root=createRoot(document.getElementById('root'));window.fixture.unmount=()=>root.unmount();root.render(<QueryClientProvider client={query}><MemberDistanceBadge username="target"/><MemberDistanceBadge username="target"/></QueryClientProvider>);`, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    plugins: [{ name: 'fixtures', setup(b) {
      b.onResolve({ filter: /.*/ }, a => {
        if (mocks[a.path]) return { path: a.path, namespace: 'mock' };
        if (a.path.startsWith('@dvnt/app/')) return { path: path.join(root, 'packages/app', a.path.slice('@dvnt/app/'.length)) + '.ts' };
      });
      b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: root }));
    }}],
  });
  const win = new Window({ url: 'https://fixture.test', console, settings: { enableJavaScriptEvaluation: true } });
  win.document.body.innerHTML = '<div id="root"></div>';
  win.fixture = { user: { authId: 'viewer', username: 'viewer' }, access: { owner: 'viewer', hydrationReady: true, blocked: false, settings: { locationEnabled: true, sessionKey: 'signin-a' } }, location: { preciseProximityGrant: true, preciseProximityOwnerAuthId: 'viewer', cityVisibility: { cityId: 1, cityName: 'City', expiresAt: Date.now()+3600000 } }, exact: {owner:null,sessionKey:null,expiresAt:0,generation:0}, calls: 0, fail: false, reply: { kind: 'distance', band: 'under_1', label: '0.01 miles away' } };
  const wait = async predicate => { for (let i=0;i<100;i++) { if (predicate()) return; await new Promise(r=>setTimeout(r,10)); } assert.ok(predicate(),win.document.body.textContent); };
  try {
    win.eval(output.outputFiles[0].text);
    await wait(()=>win.document.body.textContent.includes('Less than a mile away'));
    assert.equal(win.fixture.calls,1,'same author cards share one server query');
    assert.doesNotMatch(win.document.body.textContent,/0.01/,'never displays unsupported precise mileage');
    win.fixture.access = { ...win.fixture.access, blocked: true };
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent==='');
    win.fixture.access = { ...win.fixture.access, blocked: false };
    win.fixture.fail = true;
    win.dispatchEvent(new win.Event('fixturechange'));
    await win.fixture.query.invalidateQueries();
    await wait(()=>win.document.body.textContent==='');
    win.fixture.fail=false;
    win.fixture.reply={kind:'city',label:'In New York'};
    await win.fixture.query.invalidateQueries();
    await wait(()=>win.fixture.calls>=3);
    assert.equal(win.document.body.textContent,'','city/self/unavailable results do not claim distance');
    win.fixture.reply={kind:'distance',band:'1_5',label:'A few miles away'};
    await win.fixture.query.invalidateQueries();
    await wait(()=>win.document.body.textContent.includes('A few miles away'));
    win.fixture.location.preciseProximityGrant=false;
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent==='');
    win.fixture.location.preciseProximityGrant=true;
    win.fixture.location.preciseProximityOwnerAuthId='another-account';
    win.dispatchEvent(new win.Event('fixturechange'));
    await new Promise(r=>setTimeout(r,20));
    assert.equal(win.document.body.textContent,'','grant from another account cannot reveal cached distance');
    win.fixture.location.preciseProximityOwnerAuthId='viewer';
    win.fixture.location.cityVisibility={...win.fixture.location.cityVisibility,expiresAt:Date.now()+150};
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent.includes('A few miles away'));
    await wait(()=>win.document.body.textContent==='');
    win.fixture.location.cityVisibility={...win.fixture.location.cityVisibility,expiresAt:Date.now()+3600000};
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent.includes('A few miles away'));
    for(const query of win.fixture.query.getQueryCache().getAll())if(query.state.data) query.setState({dataUpdatedAt:Date.now()-60001});
    await wait(()=>win.document.body.textContent==='');
    win.fixture.exact={owner:'viewer',sessionKey:'signin-a',expiresAt:Date.now()+3600000,generation:1};
    win.fixture.reply={kind:'distance',consentVersion:2,miles:0.01,expiresAt:new Date(Date.now()+150).toISOString()};
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent.includes('(0.01 miles away)'));
    await wait(()=>win.document.body.textContent==='');
    win.fixture.reply={kind:'distance',consentVersion:2,miles:0.01,expiresAt:new Date(Date.now()+60000).toISOString()};
    await win.fixture.query.invalidateQueries();
    await wait(()=>win.document.body.textContent.includes('(0.01 miles away)'));
    win.fixture.access.settings={...win.fixture.access.settings,sessionKey:'signin-b'};
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent==='');
    win.fixture.user=null;
    win.dispatchEvent(new win.Event('fixturechange'));
    await wait(()=>win.document.body.textContent==='');
    console.log('PASS: mounted distance badges deduplicate authors, use coarse bands, hide on overall/precise opt-out, grant expiry, stale cache, read failure and sign-out, and omit city-only responses');
  } finally { win.fixture.unmount?.(); win.fixture.query?.clear(); await win.happyDOM.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
