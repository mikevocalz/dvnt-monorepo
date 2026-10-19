import test from "node:test";
import assert from "node:assert/strict";
import { createWebUploadScheduler, uploadRateDelay, UPLOAD_RATE_MESSAGE } from "./web-upload-rate.ts";

const limited = { data: { ok: false, error: UPLOAD_RATE_MESSAGE }, error: null };
const ok = { data: { ok: true }, error: null };

test("production HTTP 200 rate refusal waits 60 seconds; unknown failures do not retry", () => {
  assert.equal(uploadRateDelay(limited), 60_000);
  for (const result of [ok, { data: { ok: false, error: "Upload failed" } }, { error: { context: new Response(null, { status: 503 }) } }]) {
    assert.equal(uploadRateDelay(result), null);
  }
});
test("Retry-After seconds/date honored; waits bounded without retrying earlier than instructed", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const response = (retry: string) => ({ response: new Response(null, { status: 429, headers: { "Retry-After": retry } }) });
  assert.equal(uploadRateDelay(response("12"), now), 12_000);
  assert.equal(uploadRateDelay(response("Thu, 01 Jan 2026 00:00:30 GMT"), now), 30_000);
  assert.equal(uploadRateDelay(response("broken"), now), 60_000);
  assert.equal(uploadRateDelay(response("-1"), now), 60_000);
  assert.equal(uploadRateDelay(response("0"), now), 1000);
  assert.equal(uploadRateDelay(response("121"), now), null);
});
test("one explicit refusal retries once and reports visible waiting/retrying progress", async () => {
  const waits: number[] = [], messages: string[] = [];
  const run = createWebUploadScheduler({ sleep: async ms => { waits.push(ms); } });
  let calls = 0;
  assert.equal(await run(async () => ++calls === 1 ? limited : ok, message => messages.push(message)), ok);
  assert.equal(calls, 2); assert.deepEqual(waits, [60_000]);
  assert.ok(messages[0].includes("60 seconds")); assert.ok(messages[1].includes("Retrying"));
  calls = 0;
  assert.equal(await run(async () => { calls++; return limited; }), limited);
  assert.equal(calls, 2, "no unbounded automatic retries");
});
test("requests stay serial through cooldown; thrown/generic failures release queue without retry", async () => {
  let releaseWait!: () => void;
  const gate = new Promise<void>(resolve => { releaseWait = resolve; });
  const run = createWebUploadScheduler({ sleep: () => gate });
  const events: string[] = [];
  let first = true;
  const a = run(async () => { events.push("a"); if (first) { first = false; return limited; } return ok; });
  const b = run(async () => { events.push("b"); return ok; });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, ["a"]);
  releaseWait(); await Promise.all([a, b]); assert.deepEqual(events, ["a", "a", "b"]);
  let calls = 0;
  await assert.rejects(run(async () => { calls++; throw new Error("unknown network outcome"); }), /unknown network outcome/);
  assert.equal(calls, 1);
  assert.equal(await run(async () => ok), ok);
});
