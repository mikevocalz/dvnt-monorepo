/**
 * Weather FX Zustand Store
 *
 * Persists cinematic-gating date + user preferences via MMKV.
 * Memory-only state: current weather, GPU readiness, visibility flags.
 *
 * Rules:
 * - NO useState anywhere — Zustand only
 * - MMKV persist (never AsyncStorage)
 * - No setTimeout — use Debouncer from @tanstack/react-pacer if needed
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createMMKV } from "react-native-mmkv";
import {
  WeatherEffect,
  CinematicPhase,
  DEFAULT_INTENSITY,
  BURST_DURATION_MS,
  mapWeatherCodeToEffect,
  computeIntensity,
  getWeatherSeverity,
  type WeatherMetrics,
  type WeatherIntensity,
} from "./weatherTypes";

// ── Dedicated MMKV instance for weather FX ──────────────────────────
const weatherMmkv = createMMKV({ id: "weather-fx-persist" });

const weatherMmkvStorage = createJSONStorage(() => ({
  getItem: (name: string): string | null => weatherMmkv.getString(name) ?? null,
  setItem: (name: string, value: string): void => {
    weatherMmkv.set(name, value);
  },
  removeItem: (name: string): void => {
    weatherMmkv.remove(name);
  },
}));

// ── Particle count caps for accessibility / power ───────────────────
const MAX_PARTICLES_FULL = 800;
const MAX_PARTICLES_REDUCED = 150;
const MAX_PARTICLES_LOW_POWER = 80;

// ── Store interface ─────────────────────────────────────────────────
interface WeatherFXState {
  // ── Persisted ──
  lastCinematicDate: string | null;
  weatherAmbianceEnabled: boolean;
  effectIntensityScale: number; // 0–1 user slider

  // ── Memory-only ──
  weatherCode: number | null;
  metrics: WeatherMetrics | null;
  selectedEffect: WeatherEffect;
  intensity: WeatherIntensity;
  cinematicPhase: CinematicPhase;
  hasPlayedThisSession: boolean;
  reduceMotion: boolean;
  lowPower: boolean;
  batteryLevel: number | null;
  eventsTabVisible: boolean;
  gpuReady: boolean;

  // ── Burst state (30s one-shot FX) ──
  burstActive: boolean;
  burstEndTime: number | null;
  lastBurstSeverity: number;

  // ── Actions ──
  setWeather: (code: number, metrics: WeatherMetrics) => void;
  markCinematicPlayed: (today: string) => void;
  setCinematicPhase: (phase: CinematicPhase) => void;
  setFlags: (
    reduceMotion: boolean,
    lowPower: boolean,
    batteryLevel: number | null,
  ) => void;
  setEventsTabVisible: (visible: boolean) => void;
  setGpuReady: (ready: boolean) => void;
  setWeatherAmbianceEnabled: (enabled: boolean) => void;
  setEffectIntensityScale: (scale: number) => void;
  endBurst: () => void;

  // ── Derived / selectors ──
  shouldPlayCinematicToday: (today: string) => boolean;
  effectiveParticleCount: () => number;
  effectiveOpacity: () => number;
  isAnyEffectActive: () => boolean;
}

export const useWeatherFXStore = create<WeatherFXState>()(
  persist(
    (set, get) => ({
      // ── Persisted defaults ──
      lastCinematicDate: null,
      weatherAmbianceEnabled: true,
      effectIntensityScale: 1,

      // ── Memory-only defaults ──
      weatherCode: null,
      metrics: null,
      selectedEffect: WeatherEffect.None,
      intensity: DEFAULT_INTENSITY,
      cinematicPhase: CinematicPhase.Idle,
      hasPlayedThisSession: false,
      reduceMotion: false,
      lowPower: false,
      batteryLevel: null,
      eventsTabVisible: false,
      gpuReady: false,

      // ── Burst defaults ──
      burstActive: false,
      burstEndTime: null,
      lastBurstSeverity: 0,

      // ── Actions ──

      setWeather: (code, metrics) => {
        const effect = mapWeatherCodeToEffect(code);
        const intensity = computeIntensity(code, metrics);
        const newSeverity = getWeatherSeverity(code);
        const s = get();

        // Trigger burst if weather worsened (or first data on this visit)
        const shouldBurst =
          s.eventsTabVisible &&
          s.weatherAmbianceEnabled &&
          effect !== WeatherEffect.None &&
          newSeverity > s.lastBurstSeverity;

        if (shouldBurst) {
          set({
            weatherCode: code,
            metrics,
            selectedEffect: effect,
            intensity,
            burstActive: true,
            burstEndTime: Date.now() + BURST_DURATION_MS,
            lastBurstSeverity: newSeverity,
          });
        } else {
          set({
            weatherCode: code,
            metrics,
            selectedEffect: effect,
            intensity,
          });
        }
      },

      markCinematicPlayed: (today) => {
        set({ lastCinematicDate: today, hasPlayedThisSession: true });
      },

      setCinematicPhase: (phase) => {
        set({ cinematicPhase: phase });
      },

      setFlags: (reduceMotion, lowPower, batteryLevel) => {
        set({ reduceMotion, lowPower, batteryLevel });
      },

      setEventsTabVisible: (visible) => {
        if (visible) {
          // Entering events tab — trigger burst for current weather if any
          const s = get();
          const severity =
            s.weatherCode != null ? getWeatherSeverity(s.weatherCode) : 0;
          const hasEffect =
            s.selectedEffect !== WeatherEffect.None &&
            s.selectedEffect !== WeatherEffect.Clear &&
            s.weatherAmbianceEnabled;
          set({
            eventsTabVisible: true,
            burstActive: hasEffect && severity > 0,
            burstEndTime:
              hasEffect && severity > 0 ? Date.now() + BURST_DURATION_MS : null,
            lastBurstSeverity: severity,
          });
        } else {
          // Leaving events tab — reset so next visit plays fresh
          set({
            eventsTabVisible: false,
            burstActive: false,
            burstEndTime: null,
            lastBurstSeverity: 0,
          });
        }
      },

      setGpuReady: (ready) => {
        set({ gpuReady: ready });
      },

      setWeatherAmbianceEnabled: (enabled) => {
        set({ weatherAmbianceEnabled: enabled });
      },

      setEffectIntensityScale: (scale) => {
        set({ effectIntensityScale: Math.max(0, Math.min(1, scale)) });
      },

      endBurst: () => {
        set({ burstActive: false, burstEndTime: null });
      },

      // ── Selectors ──

      shouldPlayCinematicToday: (today) => {
        const s = get();
        return (
          today !== s.lastCinematicDate &&
          !s.hasPlayedThisSession &&
          !s.reduceMotion &&
          !s.lowPower &&
          (s.batteryLevel == null || s.batteryLevel > 0.2) &&
          s.weatherAmbianceEnabled
        );
      },

      effectiveParticleCount: () => {
        const s = get();
        if (!s.weatherAmbianceEnabled) return 0;

        let cap = MAX_PARTICLES_FULL;
        if (s.reduceMotion) cap = MAX_PARTICLES_REDUCED;
        if (s.lowPower || (s.batteryLevel != null && s.batteryLevel <= 0.2))
          cap = MAX_PARTICLES_LOW_POWER;

        return Math.min(
          Math.round(s.intensity.particleCount * s.effectIntensityScale),
          cap,
        );
      },

      effectiveOpacity: () => {
        const s = get();
        if (!s.weatherAmbianceEnabled) return 0;
        return s.intensity.opacity * s.effectIntensityScale;
      },

      isAnyEffectActive: () => {
        const s = get();
        return (
          s.weatherAmbianceEnabled &&
          s.selectedEffect !== WeatherEffect.None &&
          s.selectedEffect !== WeatherEffect.Clear
        );
      },
    }),
    {
      name: "weather-fx-store",
      storage: weatherMmkvStorage,
      // Only persist user preferences + cinematic gating — NOT transient weather state
      partialize: (state) => ({
        lastCinematicDate: state.lastCinematicDate,
        weatherAmbianceEnabled: state.weatherAmbianceEnabled,
        effectIntensityScale: state.effectIntensityScale,
      }),
    },
  ),
);
