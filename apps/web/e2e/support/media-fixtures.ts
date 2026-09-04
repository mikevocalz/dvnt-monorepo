/**
 * Generates the fake-capture fixtures Chrome is pointed at in
 * playwright.config.ts (`--use-file-for-fake-{video,audio}-capture`).
 *
 * These are GENERATED, not committed. Raw Y4M is uncompressed — even this tiny
 * clip is ~430 KB, and a realistic one is megabytes — so the repo carries the
 * 40 lines that make them instead of the bytes.
 *
 * They were missing entirely until 2026-09-04, and a missing path is the worst
 * possible failure here: Chrome does NOT error, it just hands the page a fake
 * camera that never produces a track and a fake mic that produces silence.
 * Every media assertion downstream then fails for a reason that looks like an
 * app bug — which is exactly how it presented.
 *
 * The video is a moving bar so "frames are arriving" is distinguishable from "a
 * frozen first frame", and the audio is loud enough to clear the VAD threshold
 * in lib/lynk/speaking-detection.ts (0.045 RMS) with room to spare.
 */

import fs from "node:fs";
import path from "node:path";

const DIR = path.join(__dirname, "../fixtures");
export const VIDEO_FIXTURE = path.join(DIR, "talking-head.y4m");
export const AUDIO_FIXTURE = path.join(DIR, "speech.wav");

const W = 160;
const H = 120;
const FPS = 15;
const FRAMES = 15; // 1s; Chrome loops it

/** Y4M 4:2:0 — a light bar sweeping across a dark field, one frame per step. */
function buildY4m(): Buffer {
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128); // neutral U/V = greyscale
  const parts: Buffer[] = [header];

  for (let f = 0; f < FRAMES; f++) {
    const luma = Buffer.alloc(W * H, 16); // near-black
    const barX = Math.floor((f / FRAMES) * W);
    for (let y = 0; y < H; y++) {
      for (let x = barX; x < Math.min(barX + 24, W); x++) luma[y * W + x] = 235;
    }
    parts.push(Buffer.from("FRAME\n"), luma, chroma, chroma);
  }
  return Buffer.concat(parts);
}

/** 16-bit mono PCM WAV — a 440 Hz tone at ~0.3 amplitude (RMS ≈ 0.21). */
function buildWav(): Buffer {
  const rate = 48_000;
  const samples = rate; // 1s, looped by Chrome
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.3;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Writes both fixtures if absent. Idempotent; safe to call every run. */
export function ensureMediaFixtures(): void {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(VIDEO_FIXTURE)) fs.writeFileSync(VIDEO_FIXTURE, buildY4m());
  if (!fs.existsSync(AUDIO_FIXTURE)) fs.writeFileSync(AUDIO_FIXTURE, buildWav());
}

export default function globalSetup(): void {
  ensureMediaFixtures();
}
