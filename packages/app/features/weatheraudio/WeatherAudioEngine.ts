/**
 * Weather Audio Engine
 *
 * Manages ambient weather sound loops with crossfade transitions.
 * Uses expo-audio (SDK 55) with safe-require for OTA compatibility.
 *
 * Rules:
 * - One active sound at a time (+ one fading out for crossfade)
 * - Fade in/out on visibility changes (never abrupt stop)
 * - Respects Reduce Motion / Low Power flags
 * - No setTimeout — volume transitions driven by tick-based approach
 */
import { WeatherEffect } from "../weatherfx/weatherTypes";
import { getWeatherSoundAsset, type SoundAsset } from "./freeSounds";
import { useWeatherFXStore } from "../weatherfx/WeatherFXStore";
import { Debouncer } from "@tanstack/react-pacer";

// ── Safe import of expo-audio ───────────────────────────────────────
let _AudioModule: any = null;
try {
  _AudioModule = require("expo-audio");
} catch {
  console.warn("[WeatherAudio] expo-audio not available in this binary");
}

// ── Types ───────────────────────────────────────────────────────────
interface ActiveSound {
  player: any; // AudioPlayer from expo-audio
  effect: WeatherEffect;
  targetVolume: number;
  currentVolume: number;
}

// ── Module state ────────────────────────────────────────────────────
let _current: ActiveSound | null = null;
let _fading: ActiveSound | null = null; // outgoing sound during crossfade
let _visible = false;
let _enabled = true;
let _intensityScale = 1;
let _volumeFadeDebouncer: Debouncer<() => void> | null = null;

// Volume lerp step per tick (called ~every 50ms)
const VOLUME_STEP = 0.05;
const FADE_TICK_MS = 50;

// ── Volume fade ticker ──────────────────────────────────────────────
// Uses Debouncer in a self-rescheduling pattern (no setInterval)
function startVolumeTicker(): void {
  if (_volumeFadeDebouncer) return;

  const tick = () => {
    processVolumeFade();
    // Reschedule if anything needs fading
    if (needsFading()) {
      _volumeFadeDebouncer?.maybeExecute();
    } else {
      _volumeFadeDebouncer = null;
    }
  };

  _volumeFadeDebouncer = new Debouncer(tick, { wait: FADE_TICK_MS });
  _volumeFadeDebouncer.maybeExecute();
}

function needsFading(): boolean {
  if (
    _current &&
    Math.abs(_current.currentVolume - _current.targetVolume) > 0.01
  )
    return true;
  if (_fading && _fading.currentVolume > 0.01) return true;
  return false;
}

function processVolumeFade(): void {
  // Fade current sound toward target
  if (_current) {
    if (_current.currentVolume < _current.targetVolume) {
      _current.currentVolume = Math.min(
        _current.currentVolume + VOLUME_STEP,
        _current.targetVolume,
      );
    } else if (_current.currentVolume > _current.targetVolume) {
      _current.currentVolume = Math.max(
        _current.currentVolume - VOLUME_STEP,
        _current.targetVolume,
      );
    }

    try {
      _current.player.volume = _current.currentVolume;
    } catch {}

    // If faded to zero, stop
    if (_current.currentVolume <= 0.01 && _current.targetVolume <= 0) {
      stopSound(_current);
      _current = null;
    }
  }

  // Fade out old sound
  if (_fading) {
    _fading.currentVolume = Math.max(_fading.currentVolume - VOLUME_STEP, 0);
    try {
      _fading.player.volume = _fading.currentVolume;
    } catch {}

    if (_fading.currentVolume <= 0.01) {
      stopSound(_fading);
      _fading = null;
    }
  }
}

async function createPlayer(asset: SoundAsset): Promise<any | null> {
  if (!_AudioModule) return null;
  try {
    const player = _AudioModule.useAudioPlayer
      ? null // hook-based — can't use outside component
      : null;

    // Use AudioPlayer class if available
    if (_AudioModule.AudioPlayer) {
      const p = new _AudioModule.AudioPlayer(asset.source);
      p.loop = asset.loop;
      p.volume = 0;
      return p;
    }

    // Fallback: createAudioPlayer function
    if (_AudioModule.createAudioPlayer) {
      const p = _AudioModule.createAudioPlayer(asset.source);
      if (p) {
        p.loop = asset.loop;
        p.volume = 0;
        return p;
      }
    }

    return null;
  } catch (err) {
    console.warn("[WeatherAudio] Failed to create player:", err);
    return null;
  }
}

function stopSound(sound: ActiveSound): void {
  try {
    sound.player?.pause?.();
    sound.player?.remove?.();
  } catch {}
}

// ── Public API ──────────────────────────────────────────────────────
export const WeatherAudioEngine = {
  /**
   * Set the active weather effect. Crossfades if effect changes.
   * No-op if effect is the same as current.
   */
  async setEffect(effect: WeatherEffect): Promise<void> {
    if (!_AudioModule || !_enabled) return;

    // Same effect — just update volume target
    if (_current?.effect === effect) {
      _current.targetVolume = computeTargetVolume(effect);
      startVolumeTicker();
      return;
    }

    const asset = getWeatherSoundAsset(effect);

    // No sound for this effect — fade out current
    if (!asset) {
      if (_current) {
        _current.targetVolume = 0;
        startVolumeTicker();
      }
      return;
    }

    // Crossfade: move current to fading slot
    if (_fading) {
      stopSound(_fading);
      _fading = null;
    }
    if (_current) {
      _fading = _current;
      _fading.targetVolume = 0;
    }

    // Create new sound
    const player = await createPlayer(asset);
    if (!player) {
      _current = null;
      return;
    }

    _current = {
      player,
      effect,
      targetVolume: _visible ? computeTargetVolume(effect) : 0,
      currentVolume: 0,
    };

    try {
      player.play?.();
    } catch (err) {
      console.warn("[WeatherAudio] play failed:", err);
    }

    startVolumeTicker();
  },

  /** Visibility changed — fade audio in/out */
  setVisible(visible: boolean): void {
    _visible = visible;
    if (_current) {
      _current.targetVolume = visible
        ? computeTargetVolume(_current.effect)
        : 0;
      startVolumeTicker();
    }
  },

  /** Update from store flags */
  setEnabled(enabled: boolean): void {
    _enabled = enabled;
    if (!enabled && _current) {
      _current.targetVolume = 0;
      startVolumeTicker();
    }
  },

  setIntensityScale(scale: number): void {
    _intensityScale = Math.max(0, Math.min(1, scale));
    if (_current) {
      _current.targetVolume = _visible
        ? computeTargetVolume(_current.effect)
        : 0;
      startVolumeTicker();
    }
  },

  /** Full cleanup */
  dispose(): void {
    if (_current) {
      stopSound(_current);
      _current = null;
    }
    if (_fading) {
      stopSound(_fading);
      _fading = null;
    }
    _volumeFadeDebouncer?.cancel();
    _volumeFadeDebouncer = null;
  },
};

function computeTargetVolume(effect: WeatherEffect): number {
  const asset = getWeatherSoundAsset(effect);
  if (!asset) return 0;

  const store = useWeatherFXStore.getState();
  if (
    store.lowPower ||
    (store.batteryLevel != null && store.batteryLevel <= 0.2)
  ) {
    return 0;
  }

  return asset.baseVolume * _intensityScale * store.effectIntensityScale;
}
