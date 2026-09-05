/**
 * node --test packages/app/lib/video/host-mute.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyHostMuteEvent,
  canSelfUnmute,
  shouldStopMic,
  NO_HOST_MUTE,
} from "./host-mute.ts";

const guest = { isHost: false, targetsSelf: true };
const other = { isHost: false, targetsSelf: false };
const host = { isHost: true, targetsSelf: false };

test("mute all locks every participant", () => {
  assert.equal(applyHostMuteEvent(NO_HOST_MUTE, "mute_all", other).locked, true);
});

test("a locked participant cannot unmute themselves", () => {
  const locked = applyHostMuteEvent(NO_HOST_MUTE, "mute_all", other);
  assert.equal(canSelfUnmute(locked, false), false);
});

test("lifting the mute restores control but does NOT open the microphone", () => {
  const locked = applyHostMuteEvent(NO_HOST_MUTE, "mute_all", other);
  const released = applyHostMuteEvent(locked, "unmute_all", other);
  assert.equal(released.locked, false);
  assert.equal(canSelfUnmute(released, false), true);
  // The releasing event must never itself be a reason to start publishing.
  assert.equal(shouldStopMic("unmute_all", other), false);
});

test("the host is never locked by their own mute", () => {
  const after = applyHostMuteEvent(NO_HOST_MUTE, "mute_all", host);
  assert.equal(after.locked, false);
  assert.equal(canSelfUnmute(after, true), true);
});

test("a targeted mute only affects the named participant", () => {
  assert.equal(applyHostMuteEvent(NO_HOST_MUTE, "mute_peer", guest).locked, true);
  assert.equal(applyHostMuteEvent(NO_HOST_MUTE, "mute_peer", other).locked, false);
  assert.equal(shouldStopMic("mute_peer", guest), true);
  assert.equal(shouldStopMic("mute_peer", other), false);
});

test("mute stops the microphone; unmute never starts it", () => {
  assert.equal(shouldStopMic("mute_all", other), true);
  assert.equal(shouldStopMic("unmute_peer", guest), false);
  assert.equal(shouldStopMic("unmute_all", other), false);
  assert.equal(shouldStopMic("mute_all", host), false, "the host is not muted by their own action");
});

test("repeat events are idempotent and preserve identity", () => {
  const locked = applyHostMuteEvent(NO_HOST_MUTE, "mute_all", other);
  assert.equal(applyHostMuteEvent(locked, "mute_all", other), locked, "no needless re-render");
  assert.equal(applyHostMuteEvent(NO_HOST_MUTE, "unmute_all", other), NO_HOST_MUTE);
});

test("an unmute aimed at someone else does not free us", () => {
  const locked = applyHostMuteEvent(NO_HOST_MUTE, "mute_peer", guest);
  assert.equal(applyHostMuteEvent(locked, "unmute_peer", other).locked, true);
});
