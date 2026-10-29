/** React lifecycle adapter test, not a native device/simulator media test. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dependencyPaths = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths: dependencyPaths });
const dependency = (name) => require(resolve(name));

(async () => {
  const { Window } = await import(pathToFileURL(resolve('happy-dom')).href);
  const window = new Window();
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.__nativeStageSize = { width: 390, height: 490 };
  global.__nativeStageInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  global.__tileMounts = {};
  global.__tileUnmounts = {};
  const React = dependency('react');
  const { createRoot } = dependency('react-dom/client');
  const bundle = await dependency('esbuild').build({
    entryPoints: [path.join(__dirname, '../packages/app/features/sneaky-lynk/ui/RoomStage.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    plugins: [{ name: 'native-stage-lifecycle-adapter', setup(build) {
      build.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, ({ path: name }) => ({ path: resolve(name), external: true }));
      build.onResolve({ filter: /^(react-native|react-native-safe-area-context|lucide-react-native|\.\/VideoGrid|\.\/RoomVideoPlayback)$/ }, ({ path: name }) => ({ path: name, namespace: 'native-adapter' }));
      build.onLoad({ filter: /.*/, namespace: 'native-adapter' }, ({ path: name }) => ({ loader: 'jsx', contents: name === 'react-native' ? `
        import React, {useLayoutEffect} from 'react';
        export function View({children, testID, onLayout, style}) {
          const {width,height}=globalThis.__nativeStageSize;
          useLayoutEffect(()=>{if(testID==='lynk-native-stage')onLayout?.({nativeEvent:{layout:{width,height}}})},[width,height,testID]);
          return <div data-testid={testID}>{children}</div>;
        }
        export const Text=({children})=><span>{children}</span>;
        export const ScrollView=({children,testID})=><div data-testid={testID}>{children}</div>;
        export const StyleSheet={create:styles=>styles};
        export const useWindowDimensions=()=>globalThis.__nativeStageSize;
      ` : name === 'react-native-safe-area-context' ? `export const useSafeAreaInsets=()=>globalThis.__nativeStageInsets;` : name === './RoomVideoPlayback' ? `export const RoomVideoPlaybackProvider=({children})=>children;` : name === './VideoGrid' ? `
        import React,{useEffect} from 'react';
        export function VideoTile({participant}) {
          const id=participant.id;
          useEffect(()=>{globalThis.__tileMounts[id]=(globalThis.__tileMounts[id]||0)+1;return()=>{globalThis.__tileUnmounts[id]=(globalThis.__tileUnmounts[id]||0)+1}},[]);
          return <div data-participant={id}>{participant.user.name}</div>;
        }
      ` : `export const Users=()=>null;` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { RoomStage } = module.exports;
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const participants = Array.from({ length: 20 }, (_, index) => ({
    id: `person-${index + 1}`, user: { id: `person-${index + 1}`, name: `Person ${index + 1}` },
    role: index === 0 ? 'host' : 'participant', isLocal: index === 0,
    isCameraOn: true, isMicOn: true,
  }));
  const render = async (people) => {
    await React.act(async () => root.render(React.createElement(RoomStage, {
      participants: people, activeSpeakers: new Set(['person-2']), isHost: true,
      hostUserId: 'person-1', stageHeight: global.__nativeStageSize.height,
    })));
    assert.equal(element.querySelectorAll('[data-participant]').length, people.length);
    assert.equal(new Set([...element.querySelectorAll('[data-participant]')].map((e) => e.getAttribute('data-participant'))).size, people.length);
  };
  for (const count of [1, 2, 12, 20]) await render(participants.slice(0, count));
  for (const size of [{width:667,height:140},{width:320,height:290},{width:1024,height:480},{width:390,height:490}]) {
    global.__nativeStageSize = size;
    global.__nativeStageInsets = { top: 0, bottom: 0, left: size.width > 600 ? 44 : 0, right: size.width > 600 ? 44 : 0 };
    await render(participants);
  }
  assert.equal(global.__tileMounts['person-1'], 1, 'host remains mounted across solo, duo, group and resize');
  for (const participant of participants) {
    assert.equal(global.__tileMounts[participant.id], 1, `${participant.id} mounts once`);
    assert.equal(global.__tileUnmounts[participant.id] || 0, 0, `${participant.id} never detaches during resize/join`);
  }
  await render(participants.filter((p) => p.id !== 'person-7'));
  assert.equal(global.__tileUnmounts['person-7'], 1, 'leaving person detaches exactly once');
  for (const participant of participants.filter((p) => p.id !== 'person-7')) {
    assert.equal(global.__tileUnmounts[participant.id] || 0, 0, `${participant.id} stays mounted when someone else leaves`);
  }
  await React.act(async () => root.unmount());
  for (const participant of participants) assert.equal(global.__tileUnmounts[participant.id], 1, 'final cleanup detaches once');
  await window.happyDOM.close();
  console.log('PASS: actual native RoomStage React tree keeps one media tile per participant through 1/2/12/20 joins, four resizes, another user leaving, and final cleanup. React adapters only; no native renderer or live transport exercised.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
