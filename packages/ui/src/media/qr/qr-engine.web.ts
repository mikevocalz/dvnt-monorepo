/**
 * QR decode engine for the web scanner — makes expo-camera's web path door-proof.
 *
 * expo-camera (57) scans on web through the Barcode Detection API: it uses
 * `globalThis.BarcodeDetector` when that exists, otherwise it dynamically
 * imports `barcode-detector` (ZXing-C++ compiled to WASM). Two things in that
 * path fail at a door, and both are settled HERE, once, before CameraView mounts:
 *
 *  1. It never asks the native detector whether it can read QR. Chrome on
 *     Linux/Windows exposes `BarcodeDetector` with NO supported formats, so
 *     `detect()` rejects forever and the WASM fallback is never reached.
 *     → we ask `getSupportedFormats()`; unless it lists `qr_code`, the ZXing
 *       detector is installed over the global, which is the class expo-camera
 *       will then construct.
 *
 *  2. The WASM comes from jsDelivr on first scan — on every iPhone, since Safari
 *     has no native detector. → self-hosted, versioned copy first
 *     (scripts/copy-zxing-wasm.cjs), CDN only as the fallback, and it is
 *     PRELOADED here so a load failure is a visible state before doors, not a
 *     scanner that silently never reads.
 */
import {
  BarcodeDetector as ZXingBarcodeDetector,
  prepareZXingModule,
  ZXING_WASM_VERSION,
} from "barcode-detector/ponyfill";

export type QrEngine = "native" | "wasm-self-hosted" | "wasm-cdn";

type NativeDetectorCtor = {
  new (init?: { formats?: string[] }): unknown;
  getSupportedFormats?: () => Promise<string[]>;
};

let ready: Promise<QrEngine> | null = null;

async function nativeReadsQr(): Promise<boolean> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Native || (Native as unknown) === ZXingBarcodeDetector) return false;
  try {
    const formats = (await Native.getSupportedFormats?.()) ?? [];
    return formats.includes("qr_code");
  } catch {
    return false;
  }
}

async function loadWasm(selfHostedUrl: string): Promise<QrEngine> {
  try {
    await prepareZXingModule({
      overrides: {
        locateFile: (file: string, prefix: string) =>
          file.endsWith(".wasm") ? selfHostedUrl : prefix + file,
      },
      fireImmediately: true,
    });
    return "wasm-self-hosted";
  } catch (selfHostedError) {
    console.warn("[qr-engine] self-hosted WASM unavailable, using CDN:", selfHostedError);
    // Same host + path zxing-wasm itself defaults to, pinned to the glue's
    // version. Passed explicitly: handing prepareZXingModule an empty
    // `overrides` does NOT restore that default (verified in the browser lab —
    // it resolved relative to the page and 404'd).
    const cdnUrl = `https://fastly.jsdelivr.net/npm/zxing-wasm@${ZXING_WASM_VERSION}/dist/reader/zxing_reader.wasm`;
    await prepareZXingModule({
      overrides: {
        locateFile: (file: string, prefix: string) =>
          file.endsWith(".wasm") ? cdnUrl : prefix + file,
      },
      fireImmediately: true,
    });
    return "wasm-cdn";
  }
}

/**
 * Idempotent. Resolves with the engine that WILL be used; rejects only when no
 * decoder can be made available (then the scanner shows the "engine" issue and
 * typed codes still work). A rejection is not cached, so "Try again" retries.
 */
export function prepareQrEngine(
  opts: { wasmBaseUrl?: string } = {},
): Promise<QrEngine> {
  if (ready) return ready;
  const base = (opts.wasmBaseUrl ?? "/vendor/zxing").replace(/\/$/, "");
  const attempt = (async (): Promise<QrEngine> => {
    if (await nativeReadsQr()) return "native";
    const engine = await loadWasm(`${base}/${ZXING_WASM_VERSION}/zxing_reader.wasm`);
    // expo-camera constructs whatever is on the global — make that ours.
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = ZXingBarcodeDetector;
    return engine;
  })();
  ready = attempt;
  attempt.catch(() => {
    if (ready === attempt) ready = null;
  });
  return attempt;
}
