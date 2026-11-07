/**
 * PLATFORM BEHAVIOR: Web-only, local video preview. A pending browser capture
 * request cannot be aborted, so every obsolete result has all tracks stopped.
 * NOT in this hook: microphone testing, room admission, publishing, native
 * capture, or guarantees about real browser permission/device behavior.
 * STOP-THE-LINE CHECKS: synthetic React tests cover StrictMode, toggle/Join/
 * unmount races, interrupted tracks and retries. Keep stop before accepted
 * admission; never acquire a device for audio-only rooms. Physical-device QA
 * remains required before release.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type PreviewState = "off" | "requesting" | "ready" | "error";

export function cameraPreviewMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow it in your browser's site settings, then retry.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found. Connect a camera, then retry.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your camera may be in use by another app. Close it there, then retry.";
  }
  return "Your camera couldn't start. Check your camera and browser permissions, then retry.";
}

/** Own exactly one preview request/stream, including requests that resolve after
 * Join, Back, a toggle, or StrictMode cleanup. Nothing here publishes media. */
export function useCameraPreview(enabled: boolean) {
  const [preview, setPreview] = useState<{
    state: PreviewState;
    stream: MediaStream | null;
    message: string | null;
  }>({ state: enabled ? "requesting" : "off", stream: null, message: null });
  const [revision, setRevision] = useState(0);
  const cancelRef = useRef<() => void>(() => {});
  const readyRef = useRef<() => boolean>(() => false);
  const isReady = useCallback(() => readyRef.current(), []);
  const stop = useCallback(() => {
    cancelRef.current();
    setPreview({ state: "off", stream: null, message: null });
  }, []);
  const retry = useCallback(() => {
    cancelRef.current();
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let owned: MediaStream | null = null;
    let removeTrackListeners = () => {};
    const cancel = () => {
      cancelled = true;
      removeTrackListeners();
      owned?.getTracks().forEach(track => track.stop());
      owned = null;
    };
    cancelRef.current = cancel;
    readyRef.current = () => {
      const track = owned?.getVideoTracks()[0];
      return !cancelled && !!track && track.readyState === "live" && !track.muted;
    };
    if (!enabled) {
      setPreview({ state: "off", stream: null, message: null });
      return cancel;
    }
    setPreview({ state: "requesting", stream: null, message: null });
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Capture unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        owned = stream;
        const track = stream.getVideoTracks()[0];
        const update = () => {
          if (cancelled) return;
          const usable = track?.readyState === "live" && !track.muted;
          setPreview(usable
            ? { state: "ready", stream, message: null }
            : { state: "error", stream: null, message: "Your camera stopped sending video. Check your device, then retry." });
        };
        track?.addEventListener("ended", update);
        track?.addEventListener("mute", update);
        track?.addEventListener("unmute", update);
        removeTrackListeners = () => {
          track?.removeEventListener("ended", update);
          track?.removeEventListener("mute", update);
          track?.removeEventListener("unmute", update);
        };
        update();
      } catch (error) {
        if (!cancelled) setPreview({ state: "error", stream: null, message: cameraPreviewMessage(error) });
      }
    })();
    return cancel;
  }, [enabled, revision]);

  return { ...preview, stop, retry, isReady };
}
