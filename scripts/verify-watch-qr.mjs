#!/usr/bin/env node
/**
 * Guards the phone → watch QR wire format.
 *
 * watchOS has no Core Image, so the phone encodes the ticket QR and ships the
 * module grid (`WatchQRMatrix`) instead of a token the watch could not draw.
 * The packing is the only non-obvious part — hex, row-major, 4 modules per
 * character, MSB first, tail padded MSB-first — and getting a bit offset wrong
 * yields a code that still *looks* like a QR but scans as nothing at the door.
 *
 * This round-trips the packer against an unpacker written to the same spec as
 * `WatchQRMatrix.modules` in apps/mobile/targets/watch/Models.swift. Keep the
 * two in lockstep: if you change one, this fails until you change the other.
 *
 *   node scripts/verify-watch-qr.mjs
 */
import assert from "node:assert";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// watch-payload.ts is TS with a runtime require; bundle it to CJS inside the
// repo so its own `react-native-qrcode-svg` require still resolves.
const tmp = mkdtempSync(join(tmpdir(), "watch-qr-"));
const bundle = join(root, "node_modules", ".verify-watch-payload.cjs");
try {
  execFileSync(
    join(root, "node_modules", ".bin", "esbuild"),
    [
      "packages/app/features/watch/watch-payload.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--packages=external",
      `--outfile=${bundle}`,
      "--log-level=warning",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const { toQRMatrix } = require(bundle);

  /** Mirrors WatchQRMatrix.modules in Models.swift — fails closed, never partial. */
  function unpack({ size, bits }) {
    if (!(size > 0)) return null;
    const count = size * size;
    const out = [];
    for (const ch of bits) {
      const nibble = parseInt(ch, 16);
      if (Number.isNaN(nibble)) return null;
      for (let shift = 3; shift >= 0 && out.length < count; shift--) {
        out.push(((nibble >> shift) & 1) === 1);
      }
    }
    return out.length === count ? out : null;
  }

  const gm = require("react-native-qrcode-svg/src/genMatrix");
  const genMatrix = gm.default ?? gm;

  // A real 64-char hex token, the shape the host scanner expects.
  const token = "a3f9".repeat(16);
  const matrix = toQRMatrix(token);
  assert.ok(matrix, "toQRMatrix returned undefined for a valid token");

  const expected = genMatrix(token, "H")
    .flat()
    .map((m) => !!m);
  assert.strictEqual(matrix.size ** 2, expected.length, "size disagrees with the encoder");
  assert.strictEqual(
    matrix.bits.length,
    Math.ceil(expected.length / 4),
    "hex length is not ceil(modules / 4)",
  );
  assert.deepStrictEqual(unpack(matrix), expected, "unpacked grid differs from the encoder");

  // Fail closed rather than draw half a code.
  assert.strictEqual(toQRMatrix(""), undefined, "empty token should yield no matrix");
  assert.strictEqual(unpack({ size: matrix.size, bits: "ab" }), null, "short bits should be null");
  assert.strictEqual(unpack({ size: matrix.size, bits: "zz" }), null, "non-hex should be null");
  assert.strictEqual(unpack({ size: 0, bits: matrix.bits }), null, "zero size should be null");

  console.log(
    `watch QR wire format OK — ${matrix.size}x${matrix.size}, ` +
      `${matrix.bits.length} hex chars (~${Math.ceil(matrix.bits.length / 2)} bytes/ticket)`,
  );
} finally {
  rmSync(bundle, { force: true });
  rmSync(tmp, { recursive: true, force: true });
}
