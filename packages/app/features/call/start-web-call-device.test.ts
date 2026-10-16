import { test } from "node:test";
import assert from "node:assert/strict";
import { startWebCallDevice, changeWebCallDevice } from "./start-web-call-device.ts";

test("already running media is not toggled off during joining", async () => {
  let toggled = false;
  assert.equal(await startWebCallDevice(() => true, async () => { toggled = true; return undefined; }, () => false), true);
  assert.equal(toggled, false);
});

test("cancel before acquiring does not request permission", async () => {
  let toggled = false;
  assert.equal(await startWebCallDevice(() => false, async () => { toggled = true; return undefined; }, () => true), false);
  assert.equal(toggled, false);
});

test("a permission response after navigation does not announce media-on", async () => {
  let cancelled = false;
  let complete!: () => void;
  const job = startWebCallDevice(() => false, () => new Promise(resolve => { complete = () => resolve(undefined); }), () => cancelled);
  cancelled = true;
  complete();
  assert.equal(await job, false);
});

test("resolved SDK device errors are failures instead of successful starts", async () => {
  await assert.rejects(startWebCallDevice(() => false, async () => ({ name: "NotAllowedError" }), () => false), { name: "NotAllowedError" });
});

test("rejected SDK starts remain failures", async () => {
  await assert.rejects(startWebCallDevice(() => false, async () => { throw new Error("Disconnected"); }, () => false), /Disconnected/);
});


test("a control toggle finishing after leave does not update the room UI", async () => {
  let left = false;
  let finish!: () => void;
  const change = changeWebCallDevice(() => new Promise(resolve => { finish = () => resolve(undefined); }), () => left);
  left = true;
  finish();
  assert.equal(await change, false);
});


test("a rejected permission response after leave is cancellation, not a new call error", async () => {
  let left = false;
  let reject!: (error: Error) => void;
  const change = changeWebCallDevice(() => new Promise((_resolve, fail) => { reject = fail; }), () => left);
  left = true;
  reject(new Error("permission response after leave"));
  assert.equal(await change, false);
});
