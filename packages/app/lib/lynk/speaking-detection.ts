/**
 * Pure speaking-detection decision (VAD hysteresis). No deps, so it is testable
 * without an AudioContext, and shared by the web + native useSpeakingDetection
 * hooks so the threshold/hang behaviour is identical on every platform.
 */

export interface SpeakingOptions {
  /** RMS above this (0..1) starts "speaking". Tuned for voice over noise. */
  threshold?: number;
  /** Hold "speaking" this long after RMS drops, so gaps between words don't flicker. */
  hangMs?: number;
}

/**
 * Given the current RMS and the timestamp of the last voice-level sample, is the
 * participant speaking now? Returns the next `lastVoiceMs` alongside the boolean.
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
