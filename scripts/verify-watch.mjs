#!/usr/bin/env node
/**
 * Guards the two watch invariants that fail late and expensively.
 *
 * 1. Every framework a watch target declares must exist in the watchOS SDK.
 *    CoreImage did not, and listing it cost a full production build: the Swift
 *    compiled fine and the LINK failed, ~12 minutes into EAS. A framework list
 *    is not type checked by anything, so check it here.
 *
 * 2. The phone → watch QR wire format.
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
 *   node scripts/verify-watch.mjs
 */
import assert from "node:assert";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// --- 1. Declared frameworks must exist in the watchOS SDK ---------------------
const targets = ["watch", "watch-complication"];
let sdk = null;
try {
  sdk = execFileSync("xcrun", ["--sdk", "watchos", "--show-sdk-path"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  console.warn("! no watchOS SDK on this machine — skipping the framework audit");
}

for (const target of targets) {
  const config = require(join(root, "apps/mobile/targets", target, "expo-target.config.js"));
  for (const framework of config.frameworks ?? []) {
    // Hard-fail regardless of SDK availability: this one has already cost a build.
    assert.notStrictEqual(
      framework,
      "CoreImage",
      `targets/${target} declares CoreImage, which does not exist on watchOS — ` +
        `the QR is encoded on the phone (see watch-payload.ts)`,
    );
    if (!sdk) continue;
    assert.ok(
      existsSync(join(sdk, "System/Library/Frameworks", `${framework}.framework`)),
      `targets/${target} declares ${framework}, absent from the watchOS SDK — it would fail at link`,
    );
  }
}
console.log(
  sdk
    ? `watch frameworks OK — every declared framework exists in ${sdk.split("/").pop()}`
    : "watch frameworks OK — CoreImage absent (SDK audit skipped)",
);

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
  // 3. RingPhase boundaries. The watch binary is arm64_32 and cannot run here,
  //    but RingPhase + Models + TicketStore import only Foundation/Combine, so
  //    the same sources build and RUN for the host. A pass that flips to blocked
  //    an hour early strands a paying member at a door — worth executing, not
  //    just type-checking.
  const watchDir = join(root, "apps/mobile/targets/watch");
  const checkBin = join(tmp, "ringphase-check");
  execFileSync(
    "swiftc",
    [
      "-o", checkBin,
      join(watchDir, "RingPhase.swift"),
      join(watchDir, "Models.swift"),
      join(watchDir, "TicketStore.swift"),
      join(root, "scripts/watch-ringphase-check/main.swift"),
    ],
    { stdio: "inherit" },
  );
  execFileSync(checkBin, { stdio: "inherit" });
} finally {
  rmSync(bundle, { force: true });
  rmSync(tmp, { recursive: true, force: true });
}
