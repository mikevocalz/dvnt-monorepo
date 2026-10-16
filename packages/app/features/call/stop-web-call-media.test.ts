import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stopWebCallMedia } from "./stop-web-call-media.ts";

test("disconnect, both SDK devices and every capture track are released", () => {
  const calls: string[] = [];
  stopWebCallMedia(() => { calls.push("leave"); },
    { stopCamera: () => { calls.push("camera"); }, cameraStream: { getTracks: () => [{ stop: () => { calls.push("video-track"); } }] } },
    { stopMicrophone: () => { calls.push("mic"); }, microphoneStream: { getTracks: () => [{ stop: () => { calls.push("audio-track"); } }] } });
  assert.deepEqual(calls, ["leave", "camera", "mic", "video-track", "audio-track"]);
});

test("a failed disconnect/camera stop cannot leave the microphone recording", () => {
  let stopped = 0;
  stopWebCallMedia(() => { throw new Error("already disconnected"); },
    { stopCamera: () => { throw new Error("camera ended"); }, cameraStream: { getTracks: () => [{ stop: () => { throw new Error("ended"); } }] } },
    { stopMicrophone: () => { stopped++; }, microphoneStream: { getTracks: () => [{ stop: () => { stopped++; } }] } });
  assert.equal(stopped, 2);
});

test("repeated teardown is safe when devices were never acquired", () => {
  for (let count = 0; count < 2; count++) {
    assert.doesNotThrow(() => stopWebCallMedia(() => {}, { stopCamera: () => {} }, { stopMicrophone: () => {} }));
  }
});

for (const path of ["./call.web.tsx", "../video/video-room.web.tsx"]) {
  test(`${path}: navigation/unmount releases media as well as the explicit leave button`, () => {
    const source = readFileSync(resolve(import.meta.dirname, path), "utf8");
    assert.equal(source.match(/stopWebCallMedia\(leaveRoomRef\.current, cameraRef\.current, micRef\.current\)/g)?.length, 2);
    assert.match(source.slice(source.indexOf("// Leave Fishjam on unmount")), /return \(\) => \{[\s\S]*?stopWebCallMedia/);
  });
}
