import { test } from "node:test";
import assert from "node:assert/strict";
import { createUsernameAvailability, type UsernameState } from "./username-availability.ts";

/** Manual clock: scheduled callbacks run only when the test says so. */
function harness(answers: Record<string, boolean | Error>) {
  const states: UsernameState[] = [];
  const queued: (() => void)[] = [];
  const asked: string[] = [];
  const pending: { name: string; resolve: () => void }[] = [];
  const checker = createUsernameAvailability({
    onChange: (s) => states.push(s),
    schedule: (fn) => {
      queued.push(fn);
      return queued.length - 1;
    },
    cancel: (h) => {
      queued[h as number] = () => {};
    },
    check: (name) =>
      new Promise((resolve, reject) => {
        asked.push(name);
        pending.push({
          name,
          resolve: () => {
            const a = answers[name];
            if (a instanceof Error) reject(a);
            else resolve({ available: a === true });
          },
        });
      }),
  });
  const flushTimers = () => queued.splice(0).forEach((fn) => fn());
  const settle = async (name: string) => {
    pending.find((p) => p.name === name)?.resolve();
    await new Promise((r) => setImmediate(r));
  };
  return { checker, states, asked, flushTimers, settle, last: () => states.at(-1) };
}

test("format errors answer at once without a network call", () => {
  const h = harness({});
  h.checker.input("ab");
  assert.equal(h.last()?.status, "invalid");
  h.checker.input("night owl");
  assert.equal(h.last()?.status, "invalid");
  h.flushTimers();
  assert.deepEqual(h.asked, []);
});

test("reserved names read as taken, not as a special case", () => {
  const h = harness({});
  h.checker.input("DeviantEvents");
  assert.deepEqual(h.last(), { status: "taken", message: "That username is taken." });
  h.flushTimers();
  assert.deepEqual(h.asked, []);
});

test("typing quickly asks once, for the final name, normalized", async () => {
  const h = harness({ nightowl: true });
  for (const partial of ["nig", "nigh", "night", "@NightOwl"]) h.checker.input(partial);
  assert.equal(h.last()?.status, "checking");
  h.flushTimers();
  assert.deepEqual(h.asked, ["nightowl"]);
  await h.settle("nightowl");
  assert.equal(h.last()?.status, "available");
});

test("a slow answer for an abandoned name never overwrites the current one", async () => {
  const h = harness({ firstname: true, second: false });
  h.checker.input("firstname");
  h.flushTimers();
  h.checker.input("second");
  h.flushTimers();
  await h.settle("second");
  assert.equal(h.last()?.status, "taken");
  await h.settle("firstname"); // arrives late
  assert.equal(h.last()?.status, "taken", "a stale 'available' replaced the current answer");
});

test("a failed check is reported as unknown, not as taken", async () => {
  const h = harness({ offline: new Error("network") });
  h.checker.input("offline");
  h.flushTimers();
  await h.settle("offline");
  assert.equal(h.last()?.status, "error");
});

test("clearing the field goes back to idle and cancels the pending check", () => {
  const h = harness({ pending: true });
  h.checker.input("pending");
  h.checker.input("");
  h.flushTimers();
  assert.equal(h.last()?.status, "idle");
  assert.deepEqual(h.asked, []);
});
