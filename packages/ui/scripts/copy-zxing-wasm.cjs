#!/usr/bin/env node
/**
 * Self-host the QR reader WASM.  usage: node copy-zxing-wasm.cjs <public-dir>
 *
 * expo-camera's web scanner (via `barcode-detector`) downloads zxing_reader.wasm
 * from the jsDelivr CDN the first time a browser without a native
 * BarcodeDetector scans — i.e. every iPhone. A door with bad signal is the
 * worst place to depend on a third-party CDN for a 1 MB file, so the web app
 * serves it itself (qr-engine.web.ts points the reader here, CDN as fallback).
 *
 * Versioned path: the JS glue and the .wasm must be the SAME zxing-wasm build.
 * /vendor/zxing/<version>/ can be cached forever and can never pair a new
 * bundle with an old binary after a deploy.
 *
 * Resolved through barcode-detector (the package that owns the dependency), so
 * it works under pnpm's strict node_modules. Never fails an install: without
 * the file the scanner falls back to the CDN.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

try {
  const publicDir = path.resolve(process.argv[2] || "public");
  const fromUi = createRequire(path.join(__dirname, "..", "package.json"));
  const bdEntry = fromUi.resolve("barcode-detector/ponyfill");
  const wasm = createRequire(bdEntry).resolve("zxing-wasm/reader/zxing_reader.wasm");

  let dir = path.dirname(wasm);
  let version = null;
  for (let i = 0; i < 6 && !version; i += 1, dir = path.dirname(dir)) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      const p = JSON.parse(fs.readFileSync(pj, "utf8"));
      if (p.name === "zxing-wasm") version = p.version;
    }
  }
  if (!version) throw new Error("could not determine zxing-wasm version");

  const out = path.join(publicDir, "vendor", "zxing", version);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(wasm, path.join(out, "zxing_reader.wasm"));
  console.log(`[copy-zxing-wasm] zxing-wasm@${version} → ${path.relative(process.cwd(), out)}/zxing_reader.wasm`);
} catch (e) {
  console.warn("[copy-zxing-wasm] skipped — scanner will use the CDN fallback:", e && e.message);
}
