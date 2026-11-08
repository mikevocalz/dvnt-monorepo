import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const web = read("../../features/sneaky-lynk/screens/room.web.tsx");
const native = read("../../features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx");

test("room headers omit the removed platform warning on both rails", () => {
  for (const source of [web, native]) {
    assert.doesNotMatch(source, /Web viewers in room|capture protection limited on web|ViewerDisclosureChip|CaptureDisclosureChip/);
  }
  assert.doesNotMatch(read("../../features/sneaky-lynk/ui/index.ts"), /CaptureDisclosureChip/);
  assert.equal(existsSync(new URL("../../features/sneaky-lynk/ui/CaptureDisclosureChip.tsx", import.meta.url)), false);
});

test("removing the label preserves capture safeguards and notifications", () => {
  assert.match(web, /<SecureCaptureBoundary\b/);
  assert.match(web, /onCaptureAttempt=\{\(kind\) => captureBroadcast.notifyLocalCapture\(kind\)\}/);
  for (const source of [web, native]) assert.match(source, /useSneakyLynkCaptureBroadcast\(/);
  assert.match(native, /useSneakyLynkCaptureProtection\(captureBroadcast.notifyLocalScreenshot\)/);
});

test("room media and viewer rendering remain in place", () => {
  assert.match(web, /useLynkBroadcast\(/);
  assert.match(web, /<RoomStage tiles=\{stageTiles\}/);
  assert.match(native, /<RoomStage\b/);
  assert.match(native, /<RemoteAudioLayer\b/);
});
