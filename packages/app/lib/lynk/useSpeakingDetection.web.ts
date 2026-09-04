/**
 * Speaking detection (VAD) for the web Lynk room, on react-native-audio-api.
 *
 * MoQ carries no VAD (unlike Fishjam's useVAD), but it doesn't need to — the
 * audio is right here. Uses react-native-audio-api's `AudioContext` (the same
 * engine mobile uses, so the RMS/hysteresis logic is identical across
 * platforms) with an `AnalyserNode`, reporting "speaking" from short-term RMS
 * with hysteresis so a ring doesn't flicker between words.
 *
 * Web source binding: react-native-audio-api's web build has no
 * `createMediaStreamSource`, only `createMediaElementSource`. The first version
 * of this hook therefore parked the stream on a hidden muted <audio> element and
 * tapped that — and it read SILENCE. Chrome does not reliably route a
 * `srcObject` MediaStream through `createMediaElementSource`; the graph gets a
 * dead node, the RMS is flat zero, and the speaking ring never lights. A live
 * two-client run is what surfaced it; the unit test covers `decideSpeaking`,
 * which was never the broken part.
 *
 * The fix keeps react-native-audio-api as the engine — so the RMS + hysteresis
 * is literally the same code path as native — and reaches through to the one
 * node its web build does not wrap. `AudioContext.context` is the underlying
 * `globalThis.AudioContext` and every wrapper exposes its `node`, so the source
 * is created natively and connected native-to-native. The analyser is never
 * connected to the destination, so nothing double-plays.
 *
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

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;

    // The two casts are the same boundary the file has always had: the unified
    // `react-native-audio-api` types barrel publishes the NATIVE signatures,
    // while webpack resolves the `.web` build at runtime. `AudioContext.web`
    // exposes `.context` (the real AudioContext) and `AudioNode.web` exposes
    // `.node` (the real node) — see web-core/*.web.d.ts. The runtime is correct;
    // only the barrel's types are the wrong platform.
    const nativeCtx = (ctx as unknown as { context: globalThis.AudioContext })
      .context;
    const nativeAnalyser = (
      analyser as unknown as { node: globalThis.AnalyserNode }
    ).node;
    const source = nativeCtx.createMediaStreamSource(stream);
    source.connect(nativeAnalyser);

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
      setSpeaking(false);
    };
  }, [stream, threshold, hangMs]);

  return speaking;
}
