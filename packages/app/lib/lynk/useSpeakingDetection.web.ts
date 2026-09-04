/**
 * Speaking detection (VAD) for the web Lynk room, on react-native-audio-api.
 *
 * MoQ carries no VAD (unlike Fishjam's useVAD), but it doesn't need to — the
 * audio is right here. Uses react-native-audio-api's `AudioContext` (the same
 * engine mobile uses, so the RMS/hysteresis logic is identical across
 * platforms) with an `AnalyserNode`, reporting "speaking" from short-term RMS
 * with hysteresis so a ring doesn't flicker between words.
 *
 * Web source binding: a live MediaStream can't be tapped directly by
 * react-native-audio-api (it has no createMediaStreamSource), so the stream is
 * attached to a hidden muted <audio> element and read via
 * `createMediaElementSource`. The element's audio is routed INTO the graph and
 * the analyser is NOT connected to the destination, so nothing double-plays.
 * On native the same hook is backed by AudioRecorder (see the native sibling).
 *
 * One context per stream, torn down on change/unmount — a leaked AudioContext
 * keeps the tab's audio "in use" and drains battery.
 */

import { useEffect, useRef, useState } from "react";
import { AudioContext } from "react-native-audio-api";
import { decideSpeaking, type SpeakingOptions } from "./speaking-detection";

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
    const hasAudio = stream
      .getAudioTracks()
      .some((t) => t.readyState === "live");
    if (!hasAudio) {
      setSpeaking(false);
      return;
    }

    // Hidden element carries the stream; react-native-audio-api taps it.
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});

    const ctx = new AudioContext();
    // createMediaElementSource redirects the element's audio into the graph;
    // connecting only to the analyser (never to ctx.destination) keeps it silent.
    // The unified react-native-audio-api types barrel exposes the NATIVE
    // signature (AudioTagHandle); the web build (AudioContext.web) actually
    // accepts an HTMLMediaElement (AudioContext.web.d.ts). Cast at this one
    // boundary — the runtime is correct.
    const source = ctx.createMediaElementSource(el as unknown as never);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    let lastVoice = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
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
      try {
        source.disconnect();
      } catch {}
      void ctx.close();
      el.srcObject = null;
      setSpeaking(false);
    };
  }, [stream, threshold, hangMs]);

  return speaking;
}
