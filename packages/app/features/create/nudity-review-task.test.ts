import test from "node:test";
import assert from "node:assert/strict";
import { runNudityReviewTask } from "./nudity-review-task.ts";

test("a stalled lazy import/lease ends in explicit incomplete review", async () => {
  let signal: AbortSignal | undefined;
  const result = await runNudityReviewTask(s => { signal = s; return new Promise(() => {}); }, new AbortController().signal, 5);
  assert.deepEqual(result, { flagged: false, incomplete: true });
  assert.equal(signal?.aborted, true);
});
test("Cancel works while the lazy module is still loading", async () => {
  const controller = new AbortController();
  const pending = runNudityReviewTask(() => new Promise(() => {}), controller.signal, 1000);
  controller.abort();
  assert.deepEqual(await pending, { flagged: false, incomplete: true });
  assert.equal(controller.signal.aborted, true);
});
test("late completion cannot turn a timeout into a clean review", async () => {
  let complete!: (value: { flagged: boolean; incomplete: boolean }) => void;
  const pending = runNudityReviewTask(() => new Promise(resolve => { complete = resolve; }), new AbortController().signal, 5);
  const result = await pending;
  complete({ flagged: false, incomplete: false });
  assert.deepEqual(result, { flagged: false, incomplete: true });
});
test("successful and flagged results are preserved; failures remain incomplete", async () => {
  for (const flagged of [true, false]) {
    assert.deepEqual(await runNudityReviewTask(async () => ({ flagged, incomplete: false }), new AbortController().signal), { flagged, incomplete: false });
  }
  assert.deepEqual(await runNudityReviewTask(() => { throw Error('chunk failed'); }, new AbortController().signal), { flagged: false, incomplete: true });
});
test("already cancelled work does not start", async () => {
  const controller = new AbortController(); controller.abort();
  await runNudityReviewTask(async () => { assert.fail('must not start'); }, controller.signal);
});
