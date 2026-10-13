import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import type { Participant } from "../types";

// Resolve the real Zustand package from the workspace or CI's isolated tools.
// createRequire honors NODE_PATH; ESM resolution alone does not.
const require = nodeModule.createRequire(import.meta.url);
const zustandUrl = pathToFileURL(require.resolve("zustand")).href;
const hooks = (nodeModule as any).registerHooks({
  resolve(specifier: string, context: unknown, next: (specifier: string, context: unknown) => unknown) {
    if (specifier === "zustand") return { url: zustandUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
const { useVideoRoomStore } = await import("./video-room-store.ts");
after(() => hooks.deregister());
beforeEach(() => useVideoRoomStore.getState().reset());

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    odId: "peer-guest", oderId: "peer-guest", userId: "guest",
    username: "guest", displayName: "Guest", avatar: "guest.png",
    role: "participant", isLocal: false, isCameraOn: true, isMicOn: true,
    isScreenSharing: false, isAnonymous: false, anonLabel: null,
    isHandRaised: false, isFrontCamera: true,
    ...overrides,
  };
}

test("the real native store replaces a same-peer broadcast after reconnect", () => {
  const firstBroadcast = { id: "peer-guest", session: "disconnected" };
  const nextBroadcast = { id: "peer-guest", session: "connected" };
  const store = useVideoRoomStore.getState();
  store.setParticipants([participant({ broadcast: firstBroadcast })]);
  let notifications = 0;
  const unsubscribe = useVideoRoomStore.subscribe(() => notifications++);
  store.setParticipants([participant({ broadcast: nextBroadcast })]);
  unsubscribe();
  assert.equal(useVideoRoomStore.getState().participants[0]!.broadcast, nextBroadcast);
  assert.equal(notifications, 1);
});

test("every displayed identity, role, anonymity and hand change reaches the real store", () => {
  const changes: Partial<Participant>[] = [
    { odId: "new-peer" }, { oderId: "new-peer" }, { username: "renamed" },
    { displayName: "New name" }, { avatar: "new-avatar.png" }, { role: "co-host" },
    { isLocal: true }, { isCameraOn: false }, { isMicOn: false },
    { isScreenSharing: true }, { isAnonymous: true }, { anonLabel: "Anon 3" },
    { isHandRaised: true }, { isFrontCamera: false },
  ];
  for (const change of changes) {
    const store = useVideoRoomStore.getState();
    store.setParticipants([participant()]);
    const updated = participant(change);
    store.setParticipants([updated]);
    assert.equal(useVideoRoomStore.getState().participants[0], updated, JSON.stringify(change));
  }
});

test("equivalent snapshots remain a no-op while legacy track replacement still updates", () => {
  const broadcast = { id: "peer-guest" };
  const initial = participant({ broadcast });
  useVideoRoomStore.getState().setParticipants([initial]);
  const before = useVideoRoomStore.getState().participants;
  useVideoRoomStore.getState().setParticipants([{ ...initial }]);
  assert.equal(useVideoRoomStore.getState().participants, before);
  const videoTrack = { stream: {}, track: { id: "new-camera" } };
  useVideoRoomStore.getState().setParticipants([{ ...initial, videoTrack }]);
  assert.equal(useVideoRoomStore.getState().participants[0]!.videoTrack, videoTrack);
});
