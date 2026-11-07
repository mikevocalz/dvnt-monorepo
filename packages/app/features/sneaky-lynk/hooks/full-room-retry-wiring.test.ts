import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { URL } from "node:url";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../../routes/screens/(protected)/sneaky-lynk/room/[id].tsx");
const server = route.slice(route.indexOf("function ServerRoom("));
const hook = read("../../video/hooks/useVideoRoom.ts");

test("native automatic and manual full-room retries share reviewed identity and media admission", () => {
  assert.match(server, /anonymous,\s+onEjected/);
  assert.match(server, /const joined = await runReviewedRetry\(canContinue\)/);
  assert.match(server, /await fullRoomRetry.retryNow\(\)/);
  assert.match(server, /const joined = await joinWithReviewedMedia\(isCurrent\)/);
  assert.equal((server.match(/videoRoomRef.current.join\(/g) || []).length, 1);
  assert.match(server, /videoRoomRef.current.join\(\{\s+isCurrent,/);
  assert.match(server, /desiredVideoEnabledRef = useRef\(roomHasVideo && initialCameraOn\)/);
  assert.match(server, /desiredMicEnabledRef = useRef\(initialMicOn\)/);
  assert.match(server, /await videoRoomRef.current.setCameraEnabled\(false\)/);
  assert.match(server, /await videoRoomRef.current.setMicEnabled\(false\)/);
});

test("native retries require open full-room surface, foreground, focus and guest scope", () => {
  assert.match(server, /eligible: joinError\?\.reason === "room_full" && !joinError.capacity\?\.isHost && !videoRoom.isAdmitted && !closedReason && !videoRoom.isEjected && !isLeaving/);
  assert.match(server, /active: isAppActive && isFocused/);
  assert.match(server, /isCurrent\(\) && AppState.currentState === "active" && focusedRef.current/);
  assert.match(server, /if \(state !== "active"\) fullRoomRetry.stop\(\)/);
  assert.match(server, /navigation.addListener\("blur", \(\) => \{/);
  assert.match(server, /fullRoomRetry.stop\(\);\s+leavingRef.current = true/);
  assert.match(server, /leaveRoom: \(\) => queueRoomDeparture\(owner, authEpoch\)/);
  assert.match(server, /return withRoomAdmissionLock\(owner, id, async \(\) =>/);
});

test("cancelled native admission is rejected before publication and cleanup belongs to original owner", () => {
  const beforeAdmission = hook.slice(hook.indexOf("const result = await videoApi.joinRoom"), hook.indexOf("setAdmittedKey(key)"));
  assert.match(beforeAdmission, /if \(attempt && !attempt.isCurrent\(\)\) \{\s+if \(result.ok\) await attempt.onAbandonedAdmission\?\.\(\);\s+return false/);
  assert.match(server, /ownsIdentity\(\) && !videoRoomRef.current.isAdmitted/);
  assert.match(server, /authIntentEpochRef.current === authEpoch/);
  assert.match(server, /useAuthStore.subscribe\(\(next, previous\) =>/);
  assert.match(server, /authIntentEpochRef.current \+= 1/);
  assert.match(server, /await sneakyLynkApi.leaveRoom\(id, \{ isCurrent: mayCleanUp \}\)/);
  assert.match(hook, /const canPublish = admitted && isPublisherRole\(localRole\)/);
});

test("capacity UI offers honest opt-in retries and removes the unused admission probe", () => {
  const sheet = read("../ui/RoomFullSheet.tsx");
  const errors = read("../errors.ts");
  assert.match(sheet, /Try automatically/);
  assert.match(sheet, /Stop trying automatically/);
  assert.match(sheet, /The current request is finishing/);
  assert.match(sheet, /cooldownSeconds > 0/);
  assert.doesNotMatch(errors, /Notify me|slide you in/);
  assert.equal(existsSync(new URL("./useRoomCapacityWatcher.ts", import.meta.url)), false);
  assert.doesNotMatch(read("../index.ts"), /useRoomCapacityWatcher/);
});
