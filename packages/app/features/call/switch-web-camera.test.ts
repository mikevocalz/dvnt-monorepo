/** node --test packages/app/features/call/switch-web-camera.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseNextCallCamera, switchWebCallCamera } from "./switch-web-camera.ts";

const devices = [
  { deviceId: "front-1", label: "Front Camera" },
  { deviceId: "back-1", label: "Back Camera" },
  { deviceId: "back-2", label: "Back Wide Angle Camera" },
];

test("front camera flips to the rear camera", () => {
  assert.equal(chooseNextCallCamera(devices, "front-1")?.deviceId, "back-1");
});
test("rear camera returns to the front camera (not a second rear lens)", () => {
  assert.equal(chooseNextCallCamera(devices, "back-1")?.deviceId, "front-1");
});
test("device aliases and duplicates do not count as separate cameras", () => {
  assert.equal(chooseNextCallCamera([
    { deviceId: "default", label: "Camera" },
    { deviceId: "front-1", label: "Front Camera" },
    { deviceId: "front-1", label: "Front Camera" },
  ], "front-1"), null);
});
test("single physical camera does not silently claim a flip", async () => {
  let selected = false;
  const result = await switchWebCallCamera({
    cameraDevices: [{ deviceId: "only", label: "Integrated Camera" }],
    currentCamera: { deviceId: "only" },
    selectCamera: async () => { selected = true; },
  });
  assert.equal(result, false);
  assert.equal(selected, false);
});
test("the live Fishjam selectCamera API receives the new device id", async () => {
  const selected: string[] = [];
  const result = await switchWebCallCamera({
    cameraDevices: devices,
    currentCamera: devices[0],
    selectCamera: async (id) => { selected.push(id); },
  });
  assert.equal(result, true);
  assert.deepEqual(selected, ["back-1"]);
});
