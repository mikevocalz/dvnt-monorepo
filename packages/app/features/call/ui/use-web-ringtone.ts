"use client";

/**
 * Ringtone for incoming calls on web.
 *
 * The web overlay rendered a full-screen "ringing" UI and played nothing, so a
 * callee sitting in another tab — or just not looking — had no idea a call was
 * arriving. Native rings through CallKit/PushKit; the browser has no
 * equivalent, so the tone is synthesised here.
 *
 * WebAudio rather than an <audio> asset deliberately: no file to ship, host or
 * cache-bust, and the classic two-tone ring is two oscillators.
 *
 * AUTOPLAY: a browser refuses audio until the tab has had a user gesture. That
 * is not a bug to work around — `start()` reports whether it managed to sound,
 * so the caller can fall back to something the browser will always allow (the
 * document title) instead of pretending the callee was alerted.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

/** North American ring: 440 Hz + 480 Hz, two seconds on, four off. */
const TONE_HZ = [440, 480];
const RING_ON_MS = 2000;
const RING_CYCLE_MS = 6000;
/** Well under a phone earpiece — this plays out of laptop speakers. */
const PEAK_GAIN = 0.12;
/** Ramp the envelope; a square-edged gate clicks audibly. */
const RAMP_S = 0.04;

export function useWebRingtone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (cycleRef.current) {
      clearInterval(cycleRef.current);
      cycleRef.current = null;
    }
    const ctx = ctxRef.current;
    ctxRef.current = null;
    // close() releases the audio hardware; leaving contexts open across
    // repeated calls exhausts the browser's limit (~6 in Chrome).
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (cycleRef.current) return true;

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return false;

    const ctx = new Ctor();
    ctxRef.current = ctx;
    try {
      // Suspended means no gesture yet. resume() rejects rather than throwing
      // asynchronously, so this is where autoplay refusal surfaces.
      if (ctx.state === "suspended") await ctx.resume();
    } catch {
      stop();
      return false;
    }
    if (ctx.state !== "running") {
      stop();
      return false;
    }

    const burst = () => {
      const live = ctxRef.current;
      if (!live || live.state !== "running") return;
      const now = live.currentTime;
      const gain = live.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + RAMP_S);
      gain.gain.setValueAtTime(PEAK_GAIN, now + RING_ON_MS / 1000 - RAMP_S);
      gain.gain.linearRampToValueAtTime(0, now + RING_ON_MS / 1000);
      gain.connect(live.destination);

      for (const hz of TONE_HZ) {
        const osc = live.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(hz, now);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + RING_ON_MS / 1000);
        // Oscillators are single-use; drop the node once it has finished or
        // a long ring accumulates dead nodes on the graph.
        osc.onended = () => osc.disconnect();
      }
    };

    burst();
    cycleRef.current = setInterval(burst, RING_CYCLE_MS);
    return true;
  }, [stop]);

  // A ring must not outlive the component that owns it — an unmount mid-ring
  // would otherwise leave the tone looping with nothing able to stop it.
  useEffect(() => stop, [stop]);

  // Memoised so a consumer can safely put this in a dependency array.
  return useMemo(() => ({ start, stop }), [start, stop]);
}
