/**
 * node --test packages/app/lib/lynk/useSpeakingDetection.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSpeaking } from "./useSpeakingDetection.web.ts";

const O = { threshold: 0.045, hangMs: 350 };

test("loud sample marks speaking and stamps the time", () => {
  const r = decideSpeaking(0.2, 0, 1000, O);
  assert.equal(r.speaking, true);
  assert.equal(r.lastVoiceMs, 1000);
});

test("quiet sample within the hang window still reads speaking", () => {
  // last voice at 1000, now 1200, hang 350 → 200 < 350 → still speaking
  const r = decideSpeaking(0.0, 1000, 1200, O);
  assert.equal(r.speaking, true);
  assert.equal(r.lastVoiceMs, 1000, "quiet does not restamp");
});

test("quiet past the hang window reads not-speaking", () => {
  const r = decideSpeaking(0.0, 1000, 1400, O); // 400 > 350
  assert.equal(r.speaking, false);
});

test("a sample exactly at threshold counts as voice", () => {
  const r = decideSpeaking(0.045, 0, 500, O);
  assert.equal(r.speaking, true);
  assert.equal(r.lastVoiceMs, 500);
});

test("brief gaps between words do not flicker off", () => {
  let last = 0;
  // word, 100ms gap, word — never crosses the 350ms hang
  let s = decideSpeaking(0.2, last, 0, O); last = s.lastVoiceMs;
  assert.equal(s.speaking, true);
  s = decideSpeaking(0.0, last, 100, O); last = s.lastVoiceMs;
  assert.equal(s.speaking, true, "100ms gap stays speaking");
  s = decideSpeaking(0.2, last, 200, O); last = s.lastVoiceMs;
  assert.equal(s.speaking, true);
});
