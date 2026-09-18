"use client";

/**
 * Sound and vibration for a verdict, because a door is loud and dark.
 *
 * Neither replaces the card. The visual verdict stays primary and always
 * carries an icon and a word, never colour alone (05-a11y.md) — this is the
 * second channel for a staffer whose eyes are on the guest, not the phone.
 *
 * Three verdicts get three DISTINCT tones rather than one alert repeated:
 * a rising pair for admitted, a flat low tone for rejected, a double blip for
 * no-verdict. Pitch carries the meaning when the words cannot be read.
 *
 * Browsers refuse to start an AudioContext before a user gesture, so it is
 * created on the first interaction rather than at mount — a context built at
 * mount lands `suspended` and every later tone is silent with no error.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FeedbackVerdict = "admitted" | "rejected" | "no_verdict";

interface DoorFeedbackState {
  soundOn: boolean;
  setSoundOn: (soundOn: boolean) => void;
}

/**
 * Persisted per device: staff turn sound off in a quiet room and expect it to
 * stay off across a reload, not to be re-surprised by it mid-shift.
 */
export const useDoorFeedbackStore = create<DoorFeedbackState>()(
  persist(
    (set) => ({ soundOn: true, setSoundOn: (soundOn) => set({ soundOn }) }),
    { name: "dvnt.door.feedback.v1" },
  ),
);

let ctx: AudioContext | null = null;

/** Call from a real user gesture. Safe to call repeatedly. */
export function primeDoorAudio(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // No audio on this device or context. Vibration and the card still work.
  }
}

function blip(at: number, hz: number, ms: number): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = hz;
  // Ramped, not switched: a square-edged gain change clicks audibly.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + ms / 1000 + 0.02);
}

const PATTERN: Record<FeedbackVerdict, { tones: [number, number][]; buzz: number[] }> = {
  // Rising: the only verdict that means "let them through".
  admitted: { tones: [[880, 90], [1320, 120]], buzz: [35] },
  // Low and flat, and the longest vibration — the one that must not be missed.
  rejected: { tones: [[320, 260]], buzz: [90, 60, 90] },
  // Two identical mid blips: not a pass, not a refusal.
  no_verdict: { tones: [[620, 80], [620, 80]], buzz: [40, 50, 40] },
};

export function signalVerdict(verdict: FeedbackVerdict): void {
  const { tones, buzz } = PATTERN[verdict];

  if (useDoorFeedbackStore.getState().soundOn && ctx && ctx.state === "running") {
    let at = ctx.currentTime;
    for (const [hz, ms] of tones) {
      blip(at, hz, ms);
      at += ms / 1000 + 0.04;
    }
  }

  // Vibration is not gated on the sound toggle: someone who silenced the room
  // still wants to feel the difference between admitted and rejected.
  try {
    navigator.vibrate?.(buzz);
  } catch {
    // Unsupported (every iOS browser today). The card is still on screen.
  }
}
