import { test } from "node:test";
import assert from "node:assert/strict";
import { commitMapConsent, consentTimeout, freshConsentPoint } from "./map-sharing-consent.ts";
import { mapGrantActive, type LocationAccessSnapshot } from "./location-access.ts";

function fixture() {
  const calls: string[] = [];
  const state = { allowed: true, sameOwner: true, failedWithdrawal: false };
  const off = { locationEnabled: false, eventsMapEnabled: false, revision: 4, shareUntil: null as string | null };
  const on = { ...off, locationEnabled: true, eventsMapEnabled: true, revision: 5, shareUntil: new Date(Date.now() + 4 * 3600_000).toISOString() };
  const deps = {
    allowed: () => state.allowed, sameOwner: () => state.sameOwner,
    point: { latitude: 40.123456, longitude: -73.123456, timestamp: Date.now() },
    settings: async () => { calls.push("settings"); return off; },
    enable: async (revision: number) => { assert.equal(revision, 4); calls.push("enable"); return on; },
    publish: async (settings: LocationAccessSnapshot, point: ReturnType<typeof freshConsentPoint>) => { assert.equal(settings.revision, 5); assert.notEqual(point.latitude, 40.123456); assert.notEqual(point.longitude, -73.123456); calls.push("publish"); },
    revoke: async () => { calls.push("revoke"); },
    withdrawalFailed: () => { state.failedWithdrawal = true; },
  };
  return { calls, state, off, on, deps };
}
test("fresh sample enables both controls then publishes only coarse point", async () => {
  const f = fixture(); assert.equal(await commitMapConsent(f.deps), f.on);
  assert.deepEqual(f.calls, ["settings", "enable", "publish"]);
});
test("an existing grant cannot be automatically renewed", async () => {
  const f = fixture(); f.deps.settings = async () => f.on;
  await assert.rejects(commitMapConsent(f.deps), /already have an active/);
  assert.deepEqual(f.calls, []);
});
test("cancel before or during settings read never enables sharing", async () => {
  for (const during of [false, true]) {
    const f = fixture(); f.state.allowed = during;
    if (during) f.deps.settings = async () => { f.state.allowed = false; return f.off; };
    await assert.rejects(commitMapConsent(f.deps), /cancelled/);
    assert.deepEqual(f.calls, []);
  }
});
test("cancel after enable compensates without publishing", async () => {
  const f = fixture(); f.deps.enable = async () => { f.calls.push("enable"); f.state.allowed = false; return f.on; };
  await assert.rejects(commitMapConsent(f.deps), /cancelled/);
  assert.deepEqual(f.calls, ["settings", "enable", "revoke"]);
});
test("account switch never sends compensation as the new account", async () => {
  const f = fixture(); f.deps.enable = async () => { f.state.allowed = false; f.state.sameOwner = false; return f.on; };
  await assert.rejects(commitMapConsent(f.deps), /cancelled/);
  assert.deepEqual(f.calls, ["settings"]);
  assert.equal(f.state.failedWithdrawal, true, "old owner retains a durable withdrawal intent");
});
test("publish failure and uncertain enable both attempt withdrawal", async () => {
  for (const stage of ["enable", "publish"] as const) {
    const f = fixture(); f.deps[stage] = async () => { throw Error("offline"); };
    await assert.rejects(commitMapConsent(f.deps), /offline/);
    assert.equal(f.calls.at(-1), "revoke");
  }
});
test("failed compensation remains explicitly unconfirmed and stops device updates", async () => {
  const f = fixture(); f.deps.publish = async () => { throw Error("offline"); }; f.deps.revoke = async () => { throw Error("offline"); };
  await assert.rejects(commitMapConsent(f.deps), /Could not confirm that sharing stopped/);
  assert.equal(f.state.failedWithdrawal, true);
});
test("cancel while publish is in flight withdraws its pin", async () => {
  const f = fixture(); f.deps.publish = async () => { f.calls.push("publish"); f.state.allowed = false; };
  await assert.rejects(commitMapConsent(f.deps), /cancelled/);
  assert.deepEqual(f.calls, ["settings", "enable", "publish", "revoke"]);
});
test("invalid, stale and future samples never enable sharing", async () => {
  for (const point of [{ timestamp: Date.now()-61_000 }, { timestamp: Date.now()+10_000 }, { latitude: NaN }, { longitude: 181 }]) {
    const f=fixture(); Object.assign(f.deps.point, point);
    await assert.rejects(commitMapConsent(f.deps)); assert.deepEqual(f.calls,["settings"]);
  }
});
test("expiry during a slow grant fails closed, without automatic renewal", async () => {
  const f = fixture(); f.deps.enable = async () => ({ ...f.on, shareUntil: new Date(Date.now()-1).toISOString() });
  await assert.rejects(commitMapConsent(f.deps), /did not confirm/); assert.deepEqual(f.calls,["settings","revoke"]);
  assert.equal(mapGrantActive(f.on, Date.parse(f.on.shareUntil!)), false);
});
test("native provider timeout rejects and late settlement cannot succeed", async () => {
  let complete!: (value: string) => void;
  const work = new Promise<string>(resolve => { complete=resolve; });
  await assert.rejects(consentTimeout(work, 1), /too long/); complete("late");
  assert.equal(await consentTimeout(Promise.resolve("fresh")), "fresh");
});
