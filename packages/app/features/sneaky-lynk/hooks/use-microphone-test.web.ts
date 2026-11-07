/**
 * PLATFORM BEHAVIOR: explicit, local-only web microphone test. No publication,
 * recording, playback or persistence. A pending browser request is not abortable:
 * every obsolete result is stopped, including Join/unmount/device switches.
 * STOP-THE-LINE: synthetic lifecycle/meter tests are not real Safari/hardware QA.
 */
import { useCallback, useEffect, useRef, useState } from "react";

function failure(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your browser's site settings, then test again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "That microphone isn't available. Connect it or choose another microphone.";
  return "Your microphone couldn't start. Check your device and browser permissions, then test again.";
}

export function useMicrophoneTest(deviceId: string, allowed: boolean) {
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<{ state: "off" | "requesting" | "ready" | "error"; level: number; message: string | null; stream: MediaStream | null }>({ state: "off", level: 0, message: null, stream: null });
  const cancelRef = useRef(() => {});
  const stop = useCallback(() => {
    cancelRef.current();
    setRequested(false);
    setResult({ state: "off", level: 0, message: null, stream: null });
  }, []);
  const start = useCallback(() => setRequested(true), []);
  useEffect(() => {
    if (!allowed) stop();
  }, [allowed, stop]);
  useEffect(() => {
    if (!requested || !allowed) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let removeListeners = () => {};
    const cancel = () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      removeListeners();
      stream?.getTracks().forEach(track => track.stop());
      void context?.close().catch(() => {});
      context = null;
    };
    cancelRef.current = cancel;
    const hidden = () => { if (document.visibilityState === "hidden") stop(); };
    document.addEventListener("visibilitychange", hidden);
    setResult({ state: "requesting", level: 0, message: null, stream: null });
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Capture unavailable");
        const acquired = await navigator.mediaDevices.getUserMedia({ video: false, audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        if (cancelled) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        const track = acquired.getAudioTracks()[0];
        if (!track || track.readyState !== "live") throw new Error("No live microphone track");
        const usable = () => !!track && track.readyState === "live" && !track.muted;
        const update = () => setResult(current => ({ ...current, state: usable() ? "ready" : "error", level: 0, stream: usable() ? acquired : null,
          message: usable() ? null : "Your microphone stopped sending audio. Check your device, then test again." }));
        track?.addEventListener("ended", update);
        track?.addEventListener("mute", update);
        track?.addEventListener("unmute", update);
        removeListeners = () => { track?.removeEventListener("ended", update); track?.removeEventListener("mute", update); track?.removeEventListener("unmute", update); };
        update();
        try {
          context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          context.createMediaStreamSource(acquired).connect(analyser);
          // Never connect to destination: no feedback, echo or replay.
          void context.resume().catch(() => {});
          const samples = new Float32Array(analyser.fftSize);
          let lastUpdate = 0;
          const tick = (now: number) => {
            if (cancelled) return;
            if (now - lastUpdate >= 100) {
              lastUpdate = now;
              analyser.getFloatTimeDomainData(samples);
              const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
              setResult(current => ({ ...current, level: usable() && context?.state === "running" ? Math.min(1, rms * 5) : 0,
                message: usable() && context?.state !== "running" ? "Microphone connected. The level meter is paused by your browser." : current.state === "ready" ? null : current.message }));
            }
            frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        } catch {
          setResult(current => ({ ...current, message: "Microphone connected. This browser can't show a level meter." }));
        }
      } catch (error) {
        if (!cancelled) { setRequested(false); setResult({ state: "error", level: 0, message: failure(error), stream: null }); }
      }
    })();
    return () => { cancel(); document.removeEventListener("visibilitychange", hidden); };
  }, [requested, deviceId, allowed, stop]);
  return { ...result, testing: requested, start, stop };
}
