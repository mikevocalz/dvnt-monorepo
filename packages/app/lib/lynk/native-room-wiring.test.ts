import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../../features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../features/video/hooks/useVideoRoom.ts", import.meta.url), "utf8");

test("native roster-count changes do not recreate the callback that owns join/leave", () => {
  const callback = route.slice(route.indexOf("const markRoomClosed = useCallback("), route.indexOf("const videoRoom = useVideoRoom("));
  assert.match(callback, /useRoomStore\.getState\(\)\.listeners\.length/);
  assert.match(callback, /\[endRoomHistory, id\]/);
  assert.doesNotMatch(callback, /storeListeners/);
  const start = route.indexOf("// Join Fishjam room on mount");
  const effect = route.slice(start, route.indexOf("  useEffect(() => {", start + 100));
  assert.match(effect, /videoRoom\.leave\(\)/);
  assert.match(effect, /\[id, markRoomClosed\]/);
  assert.doesNotMatch(effect, /storeListeners|participants/);
});

test("native room and account switches own separate component lifetimes", () => {
  assert.match(route, /<ServerRoom\s+key=\{id\}/);
  assert.match(route, /const roomAccountKey = JSON.stringify\(\[roomId, accountKey\]\)/);
  assert.match(route, /<SneakyLynkRoomScreenContent key=\{roomAccountKey\}/);
});

test("native media cannot mint before this account and room receive admission", () => {
  assert.match(hook, /const admitted = admittedKey === admissionKey && !!owner/);
  assert.match(hook, /const canPublish = admitted && isPublisherRole\(localRole\)/);
  assert.match(hook, /useLynkBroadcast\(admitted \? roomId : undefined, canPublish\)/);
});

test("late room-session refresh results cannot revive a departed room", () => {
  const refresh = hook.slice(hook.indexOf("const scheduleTokenRefresh = useCallback("), hook.indexOf("const join = useCallback("));
  assert.match(refresh, /const epoch = joinEpoch.current/);
  assert.match(refresh, /const key = admissionKeyRef.current/);
  const afterRequest = refresh.slice(refresh.indexOf("await videoApi.refreshToken("));
  assert.match(afterRequest, /if \(epoch !== joinEpoch.current \|\| key !== admissionKeyRef.current\) return/);
  const leave = hook.slice(hook.indexOf("const leave = useCallback("), hook.indexOf("// ── Media toggles"));
  assert.match(leave, /\+\+joinEpoch.current/);
  assert.match(leave, /setAdmittedKey\(null\)/);
  assert.match(leave, /mediaRef.current.end\(\)/);
});

test("authoritative room-end observation revokes native admission and media", () => {
  const end = hook.slice(hook.indexOf("const handleRoomEnded = useCallback("), hook.indexOf("const setMicEnabled = useCallback("));
  assert.match(end, /setAdmittedKey\(null\)/);
  assert.match(end, /mediaRef.current.end\(\)/);
  assert.match(end, /enabled: admitted, onEnded: handleRoomEnded/);
});

test("native and web host-end completion belongs to the originating mount lifetime", () => {
  const web = readFileSync(new URL("../../features/sneaky-lynk/screens/room.web.tsx", import.meta.url), "utf8");
  for (const source of [route, web]) {
    assert.match(source, /leaveLifetimeRef.current = \{ active: false, epoch: leaveLifetimeRef.current.epoch \+ 1 \}/);
    assert.match(source, /if \(!leaveLifetimeRef.current.active \|\| leavingRef.current\) return/);
    assert.match(source, /const isCurrent = \(\) => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch/);
    assert.match(source, /leaveRoomSafely\(\{\s+isCurrent,/);
  }
});

test("native secondary roster subscription stops when admission ends", () => {
  const subscribe = route.indexOf("const unsubscribe = videoApi.subscribeToMembers");
  const start = route.lastIndexOf("useEffect(() => {", subscribe);
  const end = route.indexOf("  useEffect(() => {", subscribe);
  const effect = route.slice(start, end);
  assert.match(effect, /if \(!id \|\| !videoRoom.isAdmitted \|\| !videoRoom.localUser\?\.id\) return/);
  assert.match(effect, /unsubscribe\?\.\(\)/);
  assert.match(effect, /videoRoom.isAdmitted,\s+\]\)/);
});
