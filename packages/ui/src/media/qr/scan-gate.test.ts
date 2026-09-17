/** node --import tsx --test packages/ui/src/media/qr/scan-gate.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { createScanGate } from "./scan-gate.ts";

const clock = () => { let t = 0; return { now: () => t, tick: (ms: number) => (t += ms) }; };

test("a code held in frame is one scan, however many frames decode", () => {
  const c = clock(); const gate = createScanGate({ absenceMs: 1200, now: c.now });
  const emitted = Array.from({ length: 20 }, () => { c.tick(300); return gate.accept("A"); });
  assert.deepEqual(emitted.filter(Boolean).length, 1);
  assert.equal(emitted[0], true);
});

test("taking the code away and presenting it again is a second scan", () => {
  const c = clock(); const gate = createScanGate({ absenceMs: 1200, now: c.now });
  c.tick(300); assert.equal(gate.accept("A"), true);
  c.tick(300); assert.equal(gate.accept("A"), false);
  c.tick(1200); assert.equal(gate.accept("A"), true);
});

test("a different code is emitted immediately — the line keeps moving", () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  c.tick(300); assert.equal(gate.accept("A"), true);
  c.tick(300); assert.equal(gate.accept("B"), true);
  c.tick(300); assert.equal(gate.accept("A"), true);
});

test("resume(): the admitted guest's code still in frame after the result card is NOT re-scanned", () => {
  const c = clock(); const gate = createScanGate({ absenceMs: 1200, now: c.now });
  c.tick(300); assert.equal(gate.accept("A"), true);
  c.tick(4000);            // result card up for 4s, decoding paused
  gate.resume();
  c.tick(300); assert.equal(gate.accept("A"), false);   // still held up → suppressed
  c.tick(300); assert.equal(gate.accept("A"), false);
  c.tick(1500); assert.equal(gate.accept("A"), true);   // genuinely re-presented
});

test("empty decodes never emit; reset() forgets the last code", () => {
  const c = clock(); const gate = createScanGate({ now: c.now });
  assert.equal(gate.accept(""), false);
  c.tick(300); assert.equal(gate.accept("A"), true);
  gate.reset(); c.tick(10); assert.equal(gate.accept("A"), true);
});
