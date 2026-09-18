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
/** A QR code held steadily in frame — the door's happy path. */
export const QR_FIXTURE = path.join(DIR, "qr-ticket.y4m");
/**
 * The payload encoded in both QR fixtures. Fixed, not random: a spec asserts
 * the scanner emits exactly this string, and a regenerated fixture must not
 * silently change what "correct" means.
 */
export const QR_FIXTURE_TOKEN = "dvnt-door-rehearsal-ticket-0001";

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

/**
 * Y4M of a QR code, for the scanner lane.
 *
 * Bigger and slower than the bar clip on purpose: expo-camera decodes on a
 * 300ms timer (ExpoCamera.web.tsx:61), so a 1s loop would give the reader only
 * ~3 attempts, and ZXing needs the code to occupy enough pixels to resolve its
 * modules. 640x480 at 10fps for 4s is what the browser lab decoded 8/8 at
 * 12-15ms/frame.
 *
 * Ten frames, not four seconds' worth. Y4M is uncompressed — 640x480 4:2:0 is
 * 460,800 bytes PER FRAME, so a 4s clip is 18 MB, and this repo shares a disk
 * with several Android build caches. Chrome loops the file, so a clip where
 * every frame carries the code is indistinguishable from a long one: the code
 * is simply always in frame.
 */
function buildQrY4m(matrix: boolean[][]): Buffer {
  const w = 640;
  const h = 480;
  const fps = 10;
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F${fps}:1 Ip A1:1 C420jpeg\n`);
  const chroma = Buffer.alloc((w / 2) * (h / 2), 128);

  // ZXing wants a quiet zone; the module size keeps the symbol ~300px wide.
  const modules = matrix.length;
  const scale = Math.max(1, Math.floor(300 / modules));
  const size = modules * scale;
  const ox = Math.floor((w - size) / 2);
  const oy = Math.floor((h - size) / 2);

  const withCode = Buffer.alloc(w * h, 200); // light field = the quiet zone
  for (let my = 0; my < modules; my++) {
    for (let mx = 0; mx < modules; mx++) {
      if (!matrix[my]![mx]) continue;
      for (let y = 0; y < scale; y++) {
        const row = (oy + my * scale + y) * w + ox + mx * scale;
        withCode.fill(16, row, row + scale);
      }
    }
  }
  const parts: Buffer[] = [header];
  for (let i = 0; i < 10; i++) {
    parts.push(Buffer.from("FRAME\n"), withCode, chroma, chroma);
  }
  return Buffer.concat(parts);
}

/**
 * QR modules for `QR_FIXTURE_TOKEN`, via the `qrcode` package that
 * react-native-qrcode-svg already puts in the graph — no new dependency, and
 * the encoder that produces our real tickets is the one producing the fixture.
 */
function qrMatrix(text: string): boolean[][] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { create } = require("qrcode") as {
    create: (t: string, o: { errorCorrectionLevel: string }) => {
      modules: { size: number; data: Uint8Array | number[] };
    };
  };
  const { modules } = create(text, { errorCorrectionLevel: "H" });
  const out: boolean[][] = [];
  for (let y = 0; y < modules.size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < modules.size; x++) row.push(!!modules.data[y * modules.size + x]);
    out.push(row);
  }
  return out;
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
  if (!fs.existsSync(QR_FIXTURE)) {
    fs.writeFileSync(QR_FIXTURE, buildQrY4m(qrMatrix(QR_FIXTURE_TOKEN)));
  }
}

export default function globalSetup(): void {
  ensureMediaFixtures();
}
