"use client";

/**
 * QR scanner (web) — expo-camera's CameraView, same as the native sibling
 * (`QrScanner.tsx`), hardened for a door.
 *
 * Replaces the html5-qrcode implementation (unpublished since 2023; its camera
 * errors were swallowed, so a denied permission was a silent black box).
 * expo-camera on web decodes with the Barcode Detection API — native where the
 * browser has it, ZXing-C++/WASM where it doesn't — see qr/qr-engine.web.ts for
 * the two gaps in that path this closes.
 *
 * What "hardened" means here:
 *  • every camera failure is a readable state with a fix (qr/camera-issues.ts)
 *  • one code in frame = one scan, however long it is held up (qr/scan-gate.ts)
 *  • the stream is rebuilt when the tab/phone comes back (iOS kills it), and
 *    when the video track ends on its own
 *  • the screen stays awake while scanning (Wake Lock, re-acquired on return)
 *  • torch + 2× zoom appear only when THIS camera actually supports them
 *  • decoding stops while `paused` (result card up) — cooler phone, longer shift
 *  • callbacks are read through refs — no stale closure over the first render
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createStore, useStore } from "zustand";
import { CameraView, useCameraPermissions } from "expo-camera";
import { prepareQrEngine, type QrEngine } from "./qr/qr-engine.web";
import { createScanGate } from "./qr/scan-gate";
import {
  classifyCameraError,
  detectPreflightIssue,
  type CameraIssue,
} from "./qr/camera-issues";
import { LegacyQrScanner } from "./QrScanner.legacy.web";

export type QrScannerStatus =
  | "starting"
  | "needs_permission"
  | "scanning"
  | "paused"
  | "blocked";

export interface QrScannerProps {
  /** Fires with the decoded text — once per presentation of a code. */
  onScan: (text: string) => void;
  /** Optional error sink (the component already renders the failure). */
  onError?: (message: string) => void;
  /** Stop after the first hit. Default true. */
  oneShot?: boolean;
  /** Stop decoding (e.g. while a result card is showing). Camera stays live. */
  paused?: boolean;
  /** Keep the screen awake while mounted. Default true. */
  keepAwake?: boolean;
  /** Lifecycle for the host screen (banner, analytics). */
  onStatusChange?: (status: QrScannerStatus, detail?: { engine?: QrEngine; issue?: CameraIssue }) => void;
}

type TrackCaps = { torch: boolean; zoom: { min: number; max: number } | null };

/**
 * The door's escape hatch. `?engine=legacy` runs the pre-rewrite html5-qrcode
 * scanner instead of this one — read from the URL so switching costs a page
 * load, never a deploy. Removed with the legacy component after Saturday.
 */
const LEGACY_PARAM = "engine";
function legacyEngineRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(LEGACY_PARAM) === "legacy";
}
function switchToLegacyEngine(): void {
  const url = new URL(window.location.href);
  url.searchParams.set(LEGACY_PARAM, "legacy");
  window.location.replace(url.toString());
}

/** Per-instance scanner state, in a Zustand store like the rest of the app. */
interface ScannerState {
  engine: QrEngine | null;
  issue: CameraIssue | null;
  /** Bumping this remounts CameraView → a brand-new MediaStream. */
  mountKey: number;
  caps: TrackCaps;
  torchOn: boolean;
  zoomed: boolean;
}
const NO_CAPS: TrackCaps = { torch: false, zoom: null };
const createScannerStore = () =>
  createStore<ScannerState>()(() => ({
    engine: null,
    issue: null,
    mountKey: 0,
    caps: NO_CAPS,
    torchOn: false,
    zoomed: false,
  }));

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Screen Wake Lock, re-acquired whenever the page becomes visible again. */
function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      try {
        sentinel = await (navigator as unknown as {
          wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
        }).wakeLock.request("screen");
      } catch {
        // Low-power mode / unsupported in this context — scanning still works.
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

export function QrScanner(props: QrScannerProps) {
  // Read once per mount, before any other hook: the engine cannot change
  // without a navigation, so the two branches never swap hook order.
  const useLegacy = useMemo(legacyEngineRequested, []);
  if (useLegacy) {
    return (
      <LegacyQrScanner
        onScan={props.onScan}
        onError={props.onError}
        oneShot={props.oneShot ?? true}
      />
    );
  }
  return <ModernQrScanner {...props} />;
}

function ModernQrScanner({
  onScan,
  onError,
  oneShot = true,
  paused = false,
  keepAwake = true,
  onStatusChange,
}: QrScannerProps) {
  const onScanRef = useLatest(onScan);
  const onErrorRef = useLatest(onError);
  const onStatusRef = useLatest(onStatusChange);

  const [permission, requestPermission] = useCameraPermissions();
  const store = useMemo(createScannerStore, []);
  const engine = useStore(store, (s) => s.engine);
  const issue = useStore(store, (s) => s.issue);
  const mountKey = useStore(store, (s) => s.mountKey);
  const caps = useStore(store, (s) => s.caps);
  const torchOn = useStore(store, (s) => s.torchOn);
  const zoomed = useStore(store, (s) => s.zoomed);

  const hostRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const gate = useMemo(() => createScanGate(), []);
  const lastIssueKind = useRef<string | null>(null);

  useScreenWakeLock(keepAwake && !issue);

  const fail = useCallback(
    (next: CameraIssue) => {
      // onMountError can fire on every decode tick — report each kind once.
      if (lastIssueKind.current === next.kind) return;
      lastIssueKind.current = next.kind;
      store.setState({ issue: next });
      onErrorRef.current?.(`${next.title}: ${next.message}`);
    },
    [onErrorRef, store],
  );

  const restart = useCallback(() => {
    lastIssueKind.current = null;
    gate.reset();
    store.setState((s) => ({
      issue: null,
      caps: NO_CAPS,
      torchOn: false,
      zoomed: false,
      mountKey: s.mountKey + 1,
    }));
  }, [gate, store]);

  // 1 ── preflight + decode engine, before the camera is ever requested.
  useEffect(() => {
    let cancelled = false;
    const pre = detectPreflightIssue({
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : true,
      hasGetUserMedia: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    });
    if (pre) {
      fail(pre);
      return;
    }
    prepareQrEngine()
      .then((e) => !cancelled && store.setState({ engine: e }))
      .catch((e) => !cancelled && fail(classifyCameraError(e ?? new Error("wasm engine failed to load"))));
    return () => {
      cancelled = true;
    };
    // mountKey: "Try again" re-runs the engine load too.
  }, [fail, mountKey, store]);

  // 2 ── the stream dies when Safari is backgrounded or the phone locks: rebuild
  //      it on return, and whenever the live track ends by itself.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 1500) {
        restart();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [restart]);

  // 3 ── read what THIS camera can do, and watch its track.
  //
  // `onCameraReady` is NOT "the camera is live" on web, and reading the track
  // inside it finds nothing. Verified in expo-camera 57.0.3:
  //   • useWebCameraStream.ts:106-107 calls setStream() then onCameraReady()
  //     synchronously, so React has not committed and <video>.srcObject is
  //     still null when the callback runs;
  //   • the FAILURE path reaches the same line — getStreamDeviceAsync() returns
  //     null, and compareStreams(null, null) is false (WebCameraUtils.ts:199),
  //     so a denied permission fires onMountError AND onCameraReady.
  // Reading once therefore left `caps` permanently empty (no torch, no zoom)
  // and never attached the `ended` listener, which is the recovery this whole
  // component depends on. So: poll for a track that actually exists.
  const capsProbe = useRef<number | null>(null);
  const probeTrack = useCallback(() => {
    if (capsProbe.current !== null) return;
    const started = Date.now();
    const look = () => {
      const video = hostRef.current?.querySelector("video");
      const track = (video?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
      if (!track || track.readyState !== "live") {
        // 4s covers a slow permission prompt; past that the watchdog in 3b
        // owns the failure, and a retry here would only spin.
        if (Date.now() - started > 4000) {
          capsProbe.current = null;
          return;
        }
        capsProbe.current = window.setTimeout(look, 150);
        return;
      }
      capsProbe.current = null;
      track.addEventListener("ended", restart, { once: true });
      const c = (track.getCapabilities?.() ?? {}) as { torch?: boolean; zoom?: { min: number; max: number } };
      store.setState({
        caps: {
          torch: !!c.torch,
          zoom: c.zoom && c.zoom.max > c.zoom.min && c.zoom.max >= 2 ? { min: c.zoom.min, max: c.zoom.max } : null,
        },
      });
    };
    look();
  }, [restart, store]);

  useEffect(
    () => () => {
      if (capsProbe.current !== null) window.clearTimeout(capsProbe.current);
      capsProbe.current = null;
    },
    [],
  );

  // Resuming after a result card: the last code may still be in frame.
  useEffect(() => {
    if (!paused) gate.resume();
  }, [paused, gate]);

  const granted = !!permission?.granted;
  const status: QrScannerStatus = issue
    ? "blocked"
    : !engine || !permission
      ? "starting"
      : !granted
        ? "needs_permission"
        : paused
          ? "paused"
          : "scanning";

  useEffect(() => {
    onStatusRef.current?.(status, { engine: engine ?? undefined, issue: issue ?? undefined });
  }, [status, engine, issue, onStatusRef]);

  // 3b ── watchdog. Nothing above guarantees a failure ever surfaces:
  // expo-camera never passes `onError` to its decode loop
  // (ExpoCamera.web.tsx:60-66), so a decoder that throws every tick is silent;
  // and useCameraPermissions' web `get` THROWS UnavailabilityError when
  // navigator.permissions.query is missing (ExpoCameraManager.web.ts:58-60)
  // rather than degrading, which leaves `permission` null forever. Either way
  // the screen would sit on "Starting camera…" indefinitely. The door bar is
  // that no state is a black box, so time it out into something readable.
  useEffect(() => {
    if (issue || status !== "starting") return;
    const t = window.setTimeout(() => {
      fail({
        kind: "unknown",
        title: "Camera didn't start",
        message: "It didn't respond. Try again, or type the ticket code below.",
        canRetry: true,
      });
    }, 8000);
    return () => window.clearTimeout(t);
  }, [issue, status, fail]);

  // expo-camera maps zoom 0..1 onto the track's [min,max]; 2× is what lets staff
  // hold the phone back far enough for close-focus-limited lenses to focus.
  //
  // 1× is Number.EPSILON, not 0, and that is not a flourish:
  // convertNormalizedSetting (WebCameraUtils.ts:344-347) opens with
  // `if (!value) return;`, so zoom={0} yields an undefined constraint and
  // applyConstraints leaves the track where it was. Toggling 2× off with 0
  // simply does nothing. EPSILON is truthy and converts to the range minimum.
  const ZOOM_1X = Number.EPSILON;
  const zoomValue =
    zoomed && caps.zoom
      ? Math.min(1, Math.max(ZOOM_1X, (2 - caps.zoom.min) / (caps.zoom.max - caps.zoom.min)))
      : ZOOM_1X;

  if (issue) {
    return (
      <div role="alert" data-qr-engine="modern" className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl bg-black px-6 text-center">
        <p className="text-[17px] font-semibold text-white">{issue.title}</p>
        <p className="text-[13px] leading-relaxed text-white/70">{issue.message}</p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {issue.canRetry ? (
            <button
              type="button"
              onClick={restart}
              className="h-11 rounded-xl bg-white px-5 text-[14px] font-semibold text-black active:scale-95"
            >
              Try again
            </button>
          ) : null}
          {/* Offered on EVERY panel, including the ones "Try again" cannot fix:
              a different engine is a different failure mode, and at a door that
              is worth one tap before falling back to typing codes. */}
          <button
            type="button"
            onClick={switchToLegacyEngine}
            className="h-11 rounded-xl border border-white/30 px-5 text-[14px] font-semibold text-white active:scale-95"
          >
            Switch scanner engine
          </button>
        </div>
      </div>
    );
  }

  if (status === "needs_permission") {
    return (
      <div data-qr-engine="modern" className="flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-2xl bg-black px-6 text-center">
        <p className="text-[15px] text-white">Camera access is needed to scan tickets.</p>
        <button
          type="button"
          onClick={() => {
            requestPermission()
              .then((r) => {
                if (!r.granted) fail(classifyCameraError({ name: "NotAllowedError" }));
              })
              .catch((e) => fail(classifyCameraError(e)));
          }}
          className="h-11 rounded-xl bg-[#3FDCFF] px-5 text-[14px] font-semibold text-black active:scale-95"
        >
          Allow camera
        </button>
      </div>
    );
  }

  return (
    <div ref={hostRef} data-qr-engine="modern" className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
      {status === "starting" ? (
        <p className="absolute inset-0 flex items-center justify-center text-[13px] text-white/60">
          Starting camera…
        </p>
      ) : (
        <CameraView
          key={mountKey}
          style={{ flex: 1, width: "100%", height: "100%" }}
          facing="back"
          enableTorch={torchOn}
          zoom={zoomValue}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onCameraReady={probeTrack}
          // CameraView already unwraps `nativeEvent` (CameraView.tsx:303-305),
          // so what arrives here is the raw DOMException getUserMedia threw.
          // classifyCameraError keys on `.name` for exactly that reason —
          // DOMException message text is browser-specific and unstable.
          onMountError={(e) => fail(classifyCameraError(e))}
          // `undefined` is how expo-camera's web scanner is switched off: no
          // handler → its decode loop stops. The camera itself stays live.
          onBarcodeScanned={
            paused
              ? undefined
              : ({ data }) => {
                  if (oneShot && doneRef.current) return;
                  if (!gate.accept(String(data ?? ""))) return;
                  doneRef.current = true;
                  onScanRef.current(String(data));
                }
          }
        />
      )}

      {caps.torch || caps.zoom ? (
        <div className="absolute bottom-3 right-3 flex gap-2">
          {caps.zoom ? (
            <button
              type="button"
              aria-pressed={zoomed}
              onClick={() => store.setState((s) => ({ zoomed: !s.zoomed }))}
              className="h-10 min-w-10 rounded-xl bg-black/60 px-3 text-[13px] font-semibold text-white backdrop-blur active:scale-95"
            >
              {zoomed ? "2×" : "1×"}
            </button>
          ) : null}
          {caps.torch ? (
            <button
              type="button"
              aria-pressed={torchOn}
              aria-label={torchOn ? "Turn light off" : "Turn light on"}
              onClick={() => store.setState((s) => ({ torchOn: !s.torchOn }))}
              className={`h-10 rounded-xl px-3 text-[13px] font-semibold backdrop-blur active:scale-95 ${
                torchOn ? "bg-white text-black" : "bg-black/60 text-white"
              }`}
            >
              Light
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
