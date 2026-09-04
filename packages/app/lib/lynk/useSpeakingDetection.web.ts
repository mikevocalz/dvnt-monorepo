/**
 * Speaking detection (VAD) for the web Lynk room — pure Web Audio, no deps.
 *
 * MoQ carries no VAD (unlike Fishjam's useVAD), but it doesn't need to: the
 * audio is right here. This taps a MediaStream (the local capture, or a remote
 * publisher's decoded audio) with an AnalyserNode and reports "speaking" from
 * short-term RMS with hysteresis, so a ring doesn't flicker on every syllable.
 *
 * One AnalyserNode per stream, torn down when the stream changes or unmounts —
 * a leaked AudioContext keeps the mic/tab "in use" and drains battery.
 */

import { useEffect, useRef, useState } from "react";

/**
 * Pure speaking decision: given the current RMS and the timestamp of the last
 * voice-level sample, is the participant speaking now? Extracted so the
 * threshold + hysteresis behaviour is testable without a DOM/AudioContext.
 * Returns the next `lastVoiceMs` alongside the boolean.
 */
export function decideSpeaking(
  rms: number,
  lastVoiceMs: number,
  nowMs: number,
  opts: { threshold: number; hangMs: number },
): { speaking: boolean; lastVoiceMs: number } {
  const lastVoice = rms >= opts.threshold ? nowMs : lastVoiceMs;
  return { speaking: nowMs - lastVoice < opts.hangMs, lastVoiceMs: lastVoice };
}

export interface SpeakingOptions {
  /** RMS above this (0..1) starts "speaking". Tuned for voice over noise. */
  threshold?: number;
  /** Hold "speaking" this long after RMS drops, so gaps between words don't flicker. */
  hangMs?: number;
}

/** True while the stream carries voice-level audio. Null stream → false. */
export function useSpeakingDetection(
  stream: MediaStream | null | undefined,
  { threshold = 0.045, hangMs = 350 }: SpeakingOptions = {},
): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || typeof window === "undefined") {
      setSpeaking(false);
      return;
    }
    // A stream with no live audio track (camera-only) never speaks.
    const hasAudio = stream.getAudioTracks().some((t) => t.readyState === "live");
    if (!hasAudio) {
      setSpeaking(false);
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let lastVoice = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      // RMS of the time-domain samples — the direct measure of loudness.
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);

      const now = performance.now();
      const d = decideSpeaking(rms, lastVoice, now, { threshold, hangMs });
      lastVoice = d.lastVoiceMs;
      setSpeaking(d.speaking);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      // close() returns a promise; we don't await teardown.
      void ctx.close();
      setSpeaking(false);
    };
  }, [stream, threshold, hangMs]);

  return speaking;
}
