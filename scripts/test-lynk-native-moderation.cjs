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
  const nativeEvents = global.__nativeModeration = { alerts: [], backListeners: new Set() };
  const React = require(resolve("react"));
  const { createRoot } = require(resolve("react-dom/client"));
  const rootPath = path.resolve(__dirname, "..");
  const ui = "packages/app/features/sneaky-lynk/ui/";
  const bundle = await require(resolve("esbuild")).build({
    stdin: {
      resolveDir: rootPath,
      loader: "tsx",
      contents: `export {RoomStage} from './${ui}RoomStage';export {ParticipantActions} from './${ui}ParticipantActions';export {RoomParticipantsSheet} from './${ui}RoomParticipantsSheet';export {HandQueueSheet} from './${ui}HandQueueSheet';`,
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
                /^(react-native|react-native-reanimated|react-native-safe-area-context|react-native-moq|lucide-react-native|@gorhom\/bottom-sheet|expo-router|@dvnt\/app\/components\/ui\/avatar|@dvnt\/app\/components\/list|@dvnt\/app\/lib\/hooks|\.\/VideoGrid)$/,
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
        const f=globalThis.__nativeModeration;
        export const View=({children,testID,accessibilityViewIsModal,accessibilityRole})=><div role={accessibilityRole} data-testid={testID} data-native-roster={accessibilityViewIsModal||undefined}>{children}</div>; export const Text=View,ScrollView=View;
        export const Pressable=({children,onPress,accessibilityLabel,disabled,accessibilityState})=><div role="button" aria-label={accessibilityLabel} aria-disabled={disabled||undefined} aria-busy={accessibilityState?.busy} onClick={disabled?undefined:onPress}>{children}</div>;
        export const TextInput=({value,onChangeText,accessibilityLabel,placeholder})=><input aria-label={accessibilityLabel} placeholder={placeholder} value={value} onInput={event=>onChangeText(event.currentTarget.value)}/>;
        export const Alert={alert:(title,message,buttons)=>f.alerts.push({title,message,buttons})};
        export const BackHandler={addEventListener:(_,listener)=>{f.backListeners.add(listener);return {remove:()=>f.backListeners.delete(listener)}}};
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
                          ? `export const Users=()=>null,Mic=Users,MicOff=Users,Crown=Users,Hand=Users,UserMinus=Users,X=Users,EyeOff=Users,Shield=Users;`
                          : n === "expo-router"
                            ? `export const useRouter=()=>({push:()=>{}});`
                            : n === "@gorhom/bottom-sheet"
                              ? `import React,{forwardRef,useImperativeHandle} from 'react';export default forwardRef(function Sheet({children,index},ref){useImperativeHandle(ref,()=>({snapToIndex(){},close(){}}),[]);return index<0?null:<div data-hand-queue>{children}</div>});export const BottomSheetBackdrop=()=>null;export const BottomSheetFlatList=({data,renderItem,keyExtractor,ListEmptyComponent,ListFooterComponent})=><div>{data.length?data.map(item=><div key={keyExtractor(item)} data-queue-id={keyExtractor(item)}>{renderItem({item})}</div>):ListEmptyComponent}{ListFooterComponent}</div>;`
                            : n.includes("/ui/avatar")
                              ? `import React from 'react';export const Avatar=({uri})=><div data-avatar-uri={uri}/>;`
                              : n.includes("/components/list")
                                ? `import React from 'react';export function LegendList({data,renderItem}){return data.map((item,index)=><div key={item.id} data-roster-row={item.id}>{renderItem({item,index})}</div>);}`
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
  const { RoomStage, ParticipantActions, RoomParticipantsSheet, HandQueueSheet } =
    module.exports;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let participants = [],
    selected = null,
    events = [],
    rosterVisible = true;
  const render = () =>
    React.act(async () => {
      const actor = participants.find((p) => p.isLocal);
      const target = participants.find((p) => p.id === selected);
      const on = (name) => (id) => events.push([name, id]);
      root.render(
        React.createElement(
          React.StrictMode,
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
            visible: rosterVisible,
            participants,
            localUserId: "me",
            actorRole: actor?.role,
            onDismiss: () => { rosterVisible = false; events.push(["roster-close"]); },
            onMute: on("mute"),
            onUnmute: on("unmute"),
            onRemove: on("remove"),
            onManageParticipant: (participant) => { selected = participant.id; rosterVisible = false; events.push(["manage", participant.id]); },
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
    participants = Array.from({ length: 30 }, (_, i) => ({
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
    assert.equal(node.querySelectorAll("[data-tile]").length, 30);
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
      assert.equal(events.some((e) => e[0] === "remove"), false, "action sheet opens confirmation rather than removing immediately");
      await React.act(async () => nativeEvents.alerts.at(-1).buttons.find(action => action.style === "cancel").onPress?.());
      await React.act(async () => nativeEvents.alerts.at(-1).buttons.find(action => action.style === "destructive").onPress());
      assert.equal(events.some((e) => e[0] === "remove"), false, "cancel invalidates the previous action-sheet confirmation");
      await click(button("Remove Person 3 from the room", dialog()));
      await React.act(async () => nativeEvents.alerts.at(-1).buttons.find(action => action.style === "destructive").onPress());
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
    /onParticipantPress=\{\s*isRoomModerator\(moderationRole\)/,
    "production route passes capability-specific handler",
  );
  assert.match(
    screen,
    /actorRole=\{moderationRole\}/,
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
  assert.match(screen, /videoRoom\.isEjected \|\| videoRoom\.room\?\.status === "ended"\s*\? null/, "terminal actors lose moderation UI");
  participants = participants.map(p => p.isLocal ? {...p, role:undefined} : p);
  selected = "guest-2";
  await render();
  assert.equal(dialog(), null, "missing local role removes action sheet");
  assert.equal(button("Mute Person 2"), null, "missing local role removes roster actions");
  // Search the actual roster, including anonymity-safe names. The stage
  // adapter deliberately stays mounted while roster results change.
  participants = [
    { id: "me", user: { id: "me", username: "Host" }, role: "host", isLocal: true, isCameraOn: false, isMicOn: true },
    { id: "search-guest", user: { id: "search-guest", username: "River" }, role: "participant", isLocal: false, isCameraOn: false, isMicOn: true },
    { id: "anonymous-guest", user: { id: "anonymous-guest", username: "hidden-real-name", displayName: "Secret Person", isAnonymous: true, anonLabel: "Anon 7" }, role: "participant", isLocal: false, isCameraOn: false, isMicOn: false },
  ];
  selected = null;
  events = [];
  await render();
  const roster = () => node.querySelector("[data-native-roster]");
  const search = async (value) => {
    const input = button("Search people in this Lynk");
    assert.ok(input, "roster has a labeled search field");
    await React.act(async () => {
      input.value = value;
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
  };
  await search("  rIvEr  ");
  assert.deepEqual([...roster().querySelectorAll("[data-roster-row]")].map(row => row.dataset.rosterRow), ["search-guest"], "search trims and ignores case");
  assert.equal(node.querySelectorAll("[data-tile]").length, 3, "roster search never removes room media tiles");
  await search("hidden-real-name");
  assert.match(roster().textContent, /No matches/);
  assert.equal(roster().querySelectorAll("[data-roster-row]").length, 0, "anonymous real identity is not searchable");
  await search("anon 7");
  assert.equal(roster().querySelector('[data-roster-row="anonymous-guest"]') != null, true, "anonymous display label remains searchable");
  assert.doesNotMatch(roster().textContent, /hidden-real-name|Secret Person/);
  assert.equal(button("View Anon 7 profile", roster()), null, "anonymous result never opens its real profile");
  await search("River");

  nativeEvents.alerts.length = 0;
  // The roster now asks before removal. Cancelling and confirming exercise
  // the real Alert callbacks instead of bypassing the confirmation boundary.
  await click(button("Remove River from the room", roster()));
  assert.equal(events.some(event => event[0] === "remove"), false, "opening confirmation does not remove anyone");
  assert.equal(nativeEvents.alerts.length, 1);
  assert.match(nativeEvents.alerts[0].title, /Remove River/);
  const cancel = nativeEvents.alerts[0].buttons.find(action => action.style === "cancel");
  assert.ok(cancel);
  await React.act(async () => cancel.onPress?.());
  await React.act(async () => nativeEvents.alerts[0].buttons.find(action => action.style === "destructive").onPress());
  assert.equal(events.some(event => event[0] === "remove"), false, "cancel invalidates even a stored confirmation callback");
  await click(button("Remove River from the room", roster()));
  const confirm = nativeEvents.alerts[1].buttons.find(action => action.style === "destructive");
  assert.ok(confirm);
  await React.act(async () => { confirm.onPress(); confirm.onPress(); });
  assert.deepEqual(events.filter(event => event[0] === "remove"), [["remove", "search-guest"]], "confirmation targets exactly the selected participant once");

  assert.equal(nativeEvents.backListeners.size, 1, "visible roster owns one Android Back listener");
  await React.act(async () => {
    const listener = [...nativeEvents.backListeners][0];
    assert.equal(listener(), true, "roster consumes Back instead of leaving the Lynk");
  });
  await render();
  assert.equal(roster(), null);
  assert.equal(nativeEvents.backListeners.size, 0, "dismissal removes the Back listener");
  rosterVisible = true;
  await render();
  assert.equal(button("Search people in this Lynk").value, "", "reopening clears the previous search");
  assert.equal(roster().querySelectorAll("[data-roster-row]").length, 3);
  // The searchable roster exposes role options without a hidden tile gesture.
  await click(button("Co-host options for River", roster()));
  await render();
  assert.equal(roster(), null);
  assert.ok(button("Make River a co-host", dialog()));
  assert.deepEqual(events.at(-1), ["manage", "search-guest"]);
  selected = null; rosterVisible = true; participants[0].role = "co-host";
  await render();
  assert.equal(button("Co-host options for River", roster()), null, "co-host cannot grant roles");
  participants[0].role = "host";
  await render();

  // A deferred confirmation cannot act on a changed account, authority,
  // departed target, promoted host, or a dismissed/reopened action sheet.
  for (const change of ["role", "target-host", "left", "account", "dismissed"]) {
    const original = participants.map(participant => ({ ...participant }));
    selected = "search-guest"; events = [];
    await render();
    await click(button("Remove River from the room", dialog()));
    const confirm = nativeEvents.alerts.at(-1).buttons.find(action => action.style === "destructive");
    if (change === "role") participants[0].role = "participant";
    if (change === "target-host") participants.find(participant => participant.id === "search-guest").role = "host";
    if (change === "left") participants = participants.filter(participant => participant.id !== "search-guest");
    if (change === "account") participants[0].id = "different-account";
    if (change === "dismissed") selected = null;
    await render();
    if (change === "dismissed") { selected = "search-guest"; await render(); }
    await React.act(async () => confirm.onPress());
    assert.equal(events.some(event => event[0] === "remove"), false, `stale action-sheet confirmation blocked after ${change}`);
    participants = original;
  }
  selected = null; events = [];
  await render();
  await click(button("Remove River from the room", roster()));
  const staleRosterConfirm = nativeEvents.alerts.at(-1).buttons.find(action => action.style === "destructive");
  participants[0].role = "participant";
  await render();
  await React.act(async () => staleRosterConfirm.onPress());
  assert.equal(events.some(event => event[0] === "remove"), false, "roster confirmation revalidates current authority");

  for (const transition of ["reopen", "leave-rejoin", "target-role-roundtrip", "actor-leave-rejoin"]) {
    participants[0].role = "host";
    rosterVisible = true; selected = null; events = [];
    await render();
    await click(button("Remove River from the room", roster()));
    const delayed = nativeEvents.alerts.at(-1).buttons.find(action => action.style === "destructive");
    const original = participants.map(participant => ({ ...participant }));
    if (transition === "reopen") rosterVisible = false;
    if (transition === "leave-rejoin") participants = participants.filter(participant => participant.id !== "search-guest");
    if (transition === "target-role-roundtrip") participants.find(participant => participant.id === "search-guest").role = "co-host";
    if (transition === "actor-leave-rejoin") participants = participants.filter(participant => !participant.isLocal);
    await render();
    participants = original; rosterVisible = true;
    await render();
    await React.act(async () => delayed.onPress());
    assert.equal(events.some(event => event[0] === "remove"), false, `old roster confirmation cannot survive ${transition}`);
  }

  const queueMembers = Array.from({ length: 30 }, (_, index) => ({
    id: "queue-" + index, isLocal: index === 0, role: index === 0 ? "host" : index === 1 ? "co-host" : "participant",
    user: { id: "queue-" + index, username: "private-user-" + index, displayName: "Private Name " + index, avatar: "/private-" + index + ".png", isAnonymous: index > 1, anonLabel: "Anon " + index },
    isMicOn: false, isCameraOn: false,
  }));
  let queueEvents = [];
  const queueProps = { visible: true, participants: queueMembers, raisedHandOrder: ["departed", ...queueMembers.map(participant => participant.id), "queue-29"], onDismiss: () => queueEvents.push(["close"]), onInviteToSpeak: id => queueEvents.push(["promote", id]), onLowerHand: id => queueEvents.push(["dismiss", id]), onLowerAll: () => queueEvents.push(["clear"]) };
  const renderQueue = props => React.act(async () => root.render(React.createElement(HandQueueSheet, props)));
  await renderQueue(queueProps);
  assert.equal(node.querySelectorAll("[data-queue-id]").length, 31, "native FIFO queue deduplicates repeated IDs without removing departed position");
  assert.match(node.textContent, /30 hands raised/);
  assert.match(node.textContent, /Anon 29/);
  assert.doesNotMatch(node.textContent, /Private Name 29|private-user-29/);
  assert.equal(node.querySelector('[data-avatar-uri="/private-29.png"]'), null, "anonymous queue avatars stay private");
  assert.equal(button("Make Private Name 0 a co-host"), null, "cannot promote self");
  assert.equal(button("Make Private Name 1 a co-host"), null, "cannot promote current co-host again");
  await click(button("Make Anon 29 a co-host"));
  assert.deepEqual(queueEvents.at(-1), ["promote", "queue-29"]);
  await click(button("Dismiss Anon 28 from your queue"));
  assert.deepEqual(queueEvents.at(-1), ["dismiss", "queue-28"]);
  await click(button("Clear position 1 from your queue"));
  assert.deepEqual(queueEvents.at(-1), ["dismiss", "departed"]);
  await renderQueue({ ...queueProps, participants: queueMembers.map(participant => participant.isLocal ? { ...participant, role: "co-host" } : participant) });
  assert.equal(button("Make Anon 29 a co-host"), null, "live loss of host authority removes queue promotion");
  let finishQueue, queueAttempts = 0;
  await renderQueue({ ...queueProps, onInviteToSpeak: () => { queueAttempts++; return new Promise(resolve => { finishQueue = resolve; }); } });
  await click(button("Make Anon 29 a co-host"));
  await click(button("Make Anon 29 a co-host"));
  assert.equal(queueAttempts, 1, "queue confirmation is not duplicated");
  assert.equal(button("Make Anon 29 a co-host").getAttribute("aria-disabled"), "true");
  assert.equal(button("Dismiss Anon 29 from your queue").getAttribute("aria-disabled"), "true");
  assert.equal(button("Clear raised hands from your view").getAttribute("aria-disabled"), "true");
  assert.equal(button("Make Anon 28 a co-host").getAttribute("aria-disabled"), null, "unrelated guests stay manageable");
  await React.act(async () => finishQueue(false));
  assert.ok(button("Make Anon 29 a co-host"), "cancel/failure retains queue entry");
  assert.equal(button("Make Anon 29 a co-host").getAttribute("aria-disabled"), null);
  await renderQueue({ ...queueProps, onInviteToSpeak: async () => { throw new Error("offline"); } });
  await click(button("Make Anon 29 a co-host"));
  assert.match(node.querySelector('[role="alert"]').textContent, /Check your connection/);

  let finishAction, actionAttempts = 0, actionCloses = 0;
  const actionProps = { visible: true, actorRole: "host", actorId: "host", participant: { userId: "guest", user: { id: "guest", username: "River" }, role: "participant", isMicOn: true }, onMute: () => { actionAttempts++; return new Promise(resolve => { finishAction = resolve; }); }, onMakeCoHost() {}, onDemote() {}, onRemove() {}, onClose: () => actionCloses++ };
  await React.act(async () => root.render(React.createElement(ParticipantActions, actionProps)));
  await click(button("Mute River", dialog()));
  await click(button("Mute River", dialog()));
  assert.equal(actionAttempts, 1, "participant action cannot duplicate pending request");
  assert.equal(button("Make River a co-host", dialog()).getAttribute("aria-disabled"), "true");
  assert.equal(actionCloses, 0, "action sheet stays open until server confirms");
  await React.act(async () => finishAction(false));
  assert.equal(actionCloses, 0, "failed action stays open for retry");
  await click(button("Mute River", dialog()));
  await React.act(async () => finishAction(true));
  assert.equal(actionCloses, 1, "successful action closes once");
  await React.act(async () => root.render(React.createElement(ParticipantActions, { ...actionProps, onMute: async () => { throw new Error("offline"); } })));
  await click(button("Mute River", dialog()));
  assert.match(node.querySelector('[role="alert"]').textContent, /Check your connection/);
  await React.act(async () => root.unmount());
  assert.equal(nativeEvents.backListeners.size, 0, "unmount removes the Back listener");
  delete global.__nativeModeration;
  await window.happyDOM.close();
  console.log(
    "PASS native production stage/roster/action sheets: 30-member fixtures, native FIFO/anonymity, deferred confirmation guards, discoverable co-host options, 4 actor roles, target hierarchy, co-host actions, consent copy, realtime role changes, stale target cleanup, anonymous-safe search, removal cancel/confirm, Android Back and listener cleanup. Native UI/SDK boundaries adapted.",
  );
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
