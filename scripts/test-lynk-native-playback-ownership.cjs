/** Actual RoomStage/RoomVideo ownership with native SDK adapters, not device QA. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const paths = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (name) => require.resolve(name, { paths });
(async () => {
  const { Window } = await import(pathToFileURL(resolve("happy-dom")).href);
  const window = new Window();
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  global.__playback = { created: {}, played: {}, stopped: {} };
  const React = require(resolve("react"));
  const { createRoot } = require(resolve("react-dom/client"));
  const bundle = await require(resolve("esbuild")).build({
    stdin: {
      resolveDir: path.join(__dirname, ".."),
      loader: "tsx",
      contents: `export {RoomStage} from './packages/app/features/sneaky-lynk/ui/RoomStage';export {RemoteAudioLayer} from './packages/app/features/sneaky-lynk/ui/RemoteAudioLayer';`,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    plugins: [
      {
        name: "native-player-adapters",
        setup(build) {
          build.onResolve(
            { filter: /^(react|react\/jsx-runtime)$/ },
            ({ path: name }) => ({ path: resolve(name), external: true }),
          );
          build.onResolve(
            {
              filter:
                /^(react-native|react-native-safe-area-context|lucide-react-native|react-native-moq|\.\/VideoGrid)$/,
            },
            ({ path: name }) => ({ path: name, namespace: "adapter" }),
          );
          build.onLoad(
            { filter: /.*/, namespace: "adapter" },
            ({ path: name }) => ({
              loader: "jsx",
              resolveDir: path.join(
                __dirname,
                "../packages/app/features/sneaky-lynk/ui",
              ),
              contents:
                name === "react-native"
                  ? `import React from 'react'; export const View=({children,testID})=><div data-testid={testID}>{children}</div>; export const ScrollView=View;export const Text=View; export const StyleSheet={create:s=>s,absoluteFill:{}};export const useWindowDimensions=()=>({width:390,height:600});`
                  : name === "react-native-safe-area-context"
                    ? `export const useSafeAreaInsets=()=>({top:0,left:0,right:0,bottom:0});`
                    : name === "lucide-react-native"
                      ? `export const Users=()=>null;`
                      : name === "react-native-moq"
                        ? `import React,{useMemo} from 'react';
          export function useVideoPlayer(broadcast){const player=useMemo(()=>{const path='video:'+broadcast.sessionId+':'+broadcast.path;const c=globalThis.__playback;c.created[path]=(c.created[path]||0)+1;return {path,play(){c.played[path]=(c.played[path]||0)+1},stop(){c.stopped[path]=(c.stopped[path]||0)+1}}},[broadcast.sessionId,broadcast.path]);return {...player};}
          export function useAudioPlayer(broadcast){return useVideoPlayer({...broadcast,path:'audio/'+broadcast.path});}
          export const VideoView=({player})=><span data-player={player.path}/>;export const PublisherView=()=>null;`
                        : `import React from 'react';import {RoomVideo} from './RoomVideo'; export function VideoTile({participant}){return <div data-participant={participant.id}>{participant.isCameraOn?<RoomVideo broadcast={participant.broadcast}/>:null}</div>;}`,
            }),
          );
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    require,
    module,
    module.exports,
  );
  const { RoomStage, RemoteAudioLayer } = module.exports;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let participants = Array.from({ length: 12 }, (_, index) => ({
    id: `person-${index}`,
    user: { id: `person-${index}`, name: `Person ${index}` },
    role: index === 0 ? "host" : index === 1 ? "co-host" : "participant",
    isLocal: index === 0,
    isCameraOn: true,
    isMicOn: true,
    broadcast:
      index === 0
        ? undefined
        : {
            path: `room/person-${index}`,
            sessionId: "session-1",
            player: { sessionId: "session-1" },
          },
  }));
  const render = async () =>
    React.act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RoomStage, {
            participants,
            activeSpeakers: new Set(),
            isHost: true,
            hostUserId: "person-0",
          }),
          React.createElement(RemoteAudioLayer, { participants }),
        ),
      ),
    );
  await render();
  const counters = global.__playback;
  assert.equal(
    Object.keys(counters.created).length,
    11,
    "one player per remote, never a self subscription",
  );
  participants = participants.map((p) =>
    p.id === "person-2"
      ? { ...p, role: "co-host" }
      : p.id === "person-1"
        ? { ...p, role: "participant" }
        : p,
  );
  await render();
  participants = participants.map((p) =>
    p.id === "person-2"
      ? { ...p, role: "participant" }
      : p.id === "person-1"
        ? { ...p, role: "co-host" }
        : p,
  );
  await render();
  for (let i = 1; i < 12; i++) {
    assert.equal(
      counters.created[`video:session-1:room/person-${i}`],
      1,
      "role changes reuse the same player",
    );
    assert.equal(
      counters.played[`video:session-1:room/person-${i}`],
      1,
      "role changes do not restart playback",
    );
    assert.equal(
      counters.stopped[`video:session-1:room/person-${i}`] || 0,
      0,
      "role changes do not interrupt audio/video",
    );
  }
  assert.equal(
    node.querySelectorAll("[data-player]").length,
    11,
    "exactly one visible native view per remote",
  );
  participants = participants.filter((p) => p.id !== "person-3");
  await render();
  assert.equal(
    counters.stopped["video:session-1:room/person-3"],
    1,
    "departed/kicked member playback stops",
  );
  assert.equal(
    node.querySelector('[data-player="video:session-1:room/person-3"]'),
    null,
  );
  participants = participants.map((p) =>
    p.id === "person-4"
      ? {
          ...p,
          broadcast: {
            path: "room/person-4-renewed",
            sessionId: "session-1",
            player: { sessionId: "session-1" },
          },
        }
      : p,
  );
  await render();
  assert.equal(
    counters.stopped["video:session-1:room/person-4"],
    1,
    "old broadcast stops exactly once",
  );
  assert.equal(
    counters.played["video:session-1:room/person-4-renewed"],
    1,
    "replacement broadcast starts",
  );
  participants = participants.map((p) =>
    p.id === "person-5" ? { ...p, isCameraOn: false } : p,
  );
  await render();
  assert.equal(
    counters.stopped["video:session-1:room/person-5"],
    1,
    "camera-off releases video ownership for audio-only layer",
  );
  assert.equal(
    counters.played["video:session-1:audio/room/person-5"],
    1,
    "camera-off mic-on peer remains audible through actual RemoteAudioLayer",
  );
  participants = participants.map((p) =>
    p.id === "person-5" ? { ...p, isCameraOn: true } : p,
  );
  await render();
  assert.equal(counters.played["video:session-1:room/person-5"], 2);
  assert.equal(
    counters.stopped["video:session-1:audio/room/person-5"],
    1,
    "camera-on does not leave duplicate audio playback",
  );
  participants = participants.map((p) =>
    p.id === "person-6" ? { ...p, isCameraOn: false } : p,
  );
  await render();
  participants = participants.map((p) =>
    p.broadcast
      ? {
          ...p,
          broadcast: {
            ...p.broadcast,
            sessionId: "session-2",
            player: { sessionId: "session-2" },
          },
        }
      : p,
  );
  await render();
  assert.equal(
    counters.stopped["video:session-1:room/person-1"],
    1,
    "same-path reconnect releases old video session",
  );
  assert.equal(
    counters.played["video:session-2:room/person-1"],
    1,
    "same-path reconnect starts new video session",
  );
  assert.equal(
    counters.stopped["video:session-1:audio/room/person-6"],
    1,
    "same-path reconnect releases old audio session",
  );
  assert.equal(
    counters.played["video:session-2:audio/room/person-6"],
    1,
    "same-path reconnect starts new audio session",
  );
  await React.act(async () => root.unmount());
  for (const [key, count] of Object.entries(counters.created))
    assert.equal(
      counters.stopped[key],
      count,
      `room exit releases every ${key} player exactly once`,
    );
  await window.happyDOM.close();
  console.log(
    "PASS: 12-person native stage owns remote playback across promotion/demotion, cleans departed members, replaces paths, handles camera-off/on and room teardown. SDK adapters, not live media/device proof.",
  );
})().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
