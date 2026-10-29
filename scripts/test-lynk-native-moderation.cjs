/** Production native stage + roster/action sheets; native UI/SDK adapters only. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const deps = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const resolve = (n) => require.resolve(n, { paths: deps });
(async () => {
  const { Window } = await import(resolve("happy-dom"));
  const window = new Window();
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = require(resolve("react"));
  const { createRoot } = require(resolve("react-dom/client"));
  const rootPath = path.resolve(__dirname, "..");
  const ui = "packages/app/features/sneaky-lynk/ui/";
  const bundle = await require(resolve("esbuild")).build({
    stdin: {
      resolveDir: rootPath,
      loader: "tsx",
      contents: `export {RoomStage} from './${ui}RoomStage';export {ParticipantActions} from './${ui}ParticipantActions';export {RoomParticipantsSheet} from './${ui}RoomParticipantsSheet';`,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
    plugins: [
      {
        name: "native-moderation-boundaries",
        setup(build) {
          build.onResolve(
            { filter: /^(react|react\/jsx-runtime)$/ },
            ({ path: n }) => ({ path: resolve(n), external: true }),
          );
          build.onResolve(
            {
              filter:
                /^(react-native|react-native-reanimated|react-native-safe-area-context|react-native-moq|lucide-react-native|expo-router|@dvnt\/app\/components\/ui\/avatar|@dvnt\/app\/components\/list|@dvnt\/app\/lib\/hooks|\.\/VideoGrid)$/,
            },
            ({ path: n }) => ({ path: n, namespace: "boundary" }),
          );
          build.onLoad(
            { filter: /.*/, namespace: "boundary" },
            ({ path: n }) => ({
              loader: "jsx",
              contents:
                n === "react-native"
                  ? `
        import React from 'react';
        export const View=({children,testID})=><div data-testid={testID}>{children}</div>; export const Text=View,ScrollView=View;
        export const Pressable=({children,onPress,accessibilityLabel})=><div role="button" aria-label={accessibilityLabel} onClick={onPress}>{children}</div>;
        export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
        export const StyleSheet={create:x=>x,absoluteFill:{},absoluteFillObject:{}};export const useWindowDimensions=()=>({width:390,height:844});
      `
                  : n === "react-native-reanimated"
                    ? `import {View} from 'react-native';const animation={delay:()=>animation,duration:()=>animation,springify:()=>animation,damping:()=>animation};export const FadeInDown=animation;export default {View};`
                    : n === "react-native-safe-area-context"
                      ? `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`
                      : n === "react-native-moq"
                        ? `export const useVideoPlayer=()=>{throw new Error('No live broadcast is allowed in moderation geometry fixture')};`
                        : n === "lucide-react-native"
                          ? `export const Users=()=>null,Mic=Users,MicOff=Users,Crown=Users,UserMinus=Users,X=Users,EyeOff=Users,Shield=Users;`
                          : n === "expo-router"
                            ? `export const useRouter=()=>({push:()=>{}});`
                            : n.includes("/ui/avatar")
                              ? `export const Avatar=()=>null;`
                              : n.includes("/components/list")
                                ? `import React from 'react';export function LegendList({data,renderItem}){return data.map((item,index)=><React.Fragment key={item.id}>{renderItem({item,index})}</React.Fragment>);}`
                                : n.includes("/lib/hooks")
                                  ? `export const useColorScheme=()=>({colors:{primary:'#fff',mutedForeground:'#ccc',border:'#333',accent:'#0ff',destructive:'#f00',secondary:'#111'}});`
                                  : `import React from 'react';export function VideoTile({participant,onPress}){return <button data-tile={participant.id} disabled={!onPress} onClick={onPress}>{participant.user.username}</button>;}`,
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
  const { RoomStage, ParticipantActions, RoomParticipantsSheet } =
    module.exports;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let participants = [],
    selected = null,
    events = [];
  const render = () =>
    React.act(async () => {
      const actor = participants.find((p) => p.isLocal);
      const target = participants.find((p) => p.id === selected);
      const on = (name) => (id) => events.push([name, id]);
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RoomStage, {
            participants,
            activeSpeakers: new Set(),
            isHost: actor?.role === "host",
            hostUserId: participants.find((p) => p.role === "host")?.id,
            onParticipantPress: (p) => {
              selected = p.id;
              events.push(["select", p.id]);
            },
          }),
          React.createElement(RoomParticipantsSheet, {
            visible: true,
            participants,
            localUserId: "me",
            actorRole: actor?.role,
            onDismiss: () => {},
            onMute: on("mute"),
            onUnmute: on("unmute"),
            onRemove: on("remove"),
          }),
          React.createElement(ParticipantActions, {
            visible: !!target,
            participant: target
              ? {
                  userId: target.id,
                  user: target.user,
                  role: target.role,
                  isMicOn: target.isMicOn,
                }
              : null,
            actorRole: actor?.role,
            actorId: actor?.id,
            onMute: on("mute"),
            onUnmute: on("unmute"),
            onMakeCoHost: on("promote"),
            onDemote: on("demote"),
            onRemove: on("remove"),
            onClose: () => {
              selected = null;
              events.push(["close"]);
            },
          }),
        ),
      );
    });
  const button = (label, scope = node) =>
    scope.querySelector(`[aria-label="${label}"]`);
  const dialog = () => node.querySelector('[role="dialog"]');
  const click = async (element) => {
    assert.ok(element);
    await React.act(async () => element.click());
  };
  for (const role of ["host", "co-host", "moderator", "participant"]) {
    participants = Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? "me" : "guest-" + i,
      user: { id: i === 0 ? "me" : "guest-" + i, username: "Person " + i },
      role:
        i === 0
          ? role
          : i === 1
            ? role === "host"
              ? "co-host"
              : "host"
            : i === 2
              ? "moderator"
              : "participant",
      isLocal: i === 0,
      isCameraOn: false,
      isMicOn: true,
    }));
    selected = null;
    events = [];
    await render();
    assert.equal(node.querySelectorAll("[data-tile]").length, 12);
    assert.equal(
      node.querySelector('[data-tile="me"]').disabled,
      true,
      "self tile cannot open actions",
    );
    if (role !== "host")
      assert.equal(
        node.querySelector('[data-tile="guest-1"]').disabled,
        true,
        "host tile cannot open actions",
      );
    const allowed = role !== "participant";
    assert.equal(
      node.querySelector('[data-tile="guest-3"]').disabled,
      !allowed,
    );
    assert.equal(
      !!button("Mute Person 3"),
      allowed,
      "roster actions available only to moderator roles",
    );
    if (role === "moderator")
      assert.equal(
        button("Remove Person 2 from the room"),
        null,
        "peer moderator protected from remove",
      );
    if (role === "co-host") {
      // Another co-host is a hero tile when placed before the local co-host.
      participants[2].role = "co-host";
      participants = [
        participants[1],
        participants[2],
        participants[0],
        ...participants.slice(3),
      ];
      await render();
      await click(node.querySelector('[data-tile="guest-2"]'));
      await render();
      assert.ok(
        button("Mute Person 2", dialog()),
        "co-host hero tile opens actions",
      );
      selected = null;
      participants = [...participants].sort((a, b) =>
        a.isLocal
          ? -1
          : b.isLocal
            ? 1
            : a.id.localeCompare(b.id, undefined, { numeric: true }),
      );
      await render();
    }
    if (allowed) {
      await click(node.querySelector('[data-tile="guest-3"]'));
      await render();
      assert.ok(dialog(), "actual stage selection opens actual action sheet");
      assert.equal(
        !!button("Make Person 3 a co-host", dialog()),
        role === "host",
        "role escalation stays host-only",
      );
      await click(button("Mute Person 3", dialog()));
      assert.ok(events.some((e) => e[0] === "mute" && e[1] === "guest-3"));
      selected = "guest-3";
      participants[3].isMicOn = false;
      await render();
      assert.match(
        dialog().textContent,
        /They choose when to turn their microphone on/,
        "unmute copy respects consent",
      );
      await click(button("Let Person 3 unmute", dialog()));
      assert.ok(events.some((e) => e[0] === "unmute" && e[1] === "guest-3"));
      selected = "guest-3";
      await render();
      await click(button("Remove Person 3 from the room", dialog()));
      assert.ok(events.some((e) => e[0] === "remove"));
      selected = "guest-3";
      participants[0].role = "participant";
      await render();
      assert.equal(dialog(), null, "demotion closes actionable UI");
      participants[0].role = "co-host";
      await render();
      assert.ok(dialog(), "promotion restores allowed actions");
      participants = participants.filter((p) => p.id !== "guest-3");
      await render();
      assert.equal(dialog(), null, "departed target clears stale actions");
    }
  }
  const tile = fs.readFileSync(
    path.join(rootPath, ui, "VideoGrid.tsx"),
    "utf8",
  );
  assert.match(
    tile,
    /onLongPress=\{onPress\}/,
    "real VideoTile forwards the stage action without a host gate",
  );
  const screen = fs.readFileSync(
    path.join(
      rootPath,
      "packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx",
    ),
    "utf8",
  );
  assert.match(
    screen,
    /onParticipantPress=\{\s*isRoomModerator\(videoRoom\.localUser\?\.role\)/,
    "production route passes capability-specific handler",
  );
  assert.match(
    screen,
    /actorRole=\{videoRoom\.localUser\?\.role\}/,
    "production route supplies server role",
  );
  assert.match(
    screen,
    /allParticipants\.find\(\s*\(member\) => member\.id === actionTarget\?\.id,?\s*\)/,
    "production route reconciles selected target",
  );
  assert.match(
    screen,
    /onMuteAll=\{isHost \? handleToggleMuteAll : undefined\}/,
    "bulk control remains host-only",
  );
  await React.act(async () => root.unmount());
  await window.happyDOM.close();
  console.log(
    "PASS native production stage/roster/action sheets:12members,4actor roles,target hierarchy,cohost actions,consent copy,realtime demotion/promotion and stale target cleanup. Native UI/SDK boundaries adapted.",
  );
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
