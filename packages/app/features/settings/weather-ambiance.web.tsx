"use client";

import { useRouter } from "solito/navigation";
import { CloudRain, Snowflake, Sun, X } from "lucide-react";
import { useWeatherFXStore } from "@dvnt/app/src/features/weatherfx/WeatherFXStore";

/**
 * Weather Ambiance settings — web (Phase 1 port of native
 * `app/settings/weather-ambiance.tsx`). Law 1: faithful to the native data flow —
 * the on/off toggle and intensity scale come from `useWeatherFXStore` via the
 * exact same selectors/setters as native (`weatherAmbianceEnabled` /
 * `setWeatherAmbianceEnabled`, `effectIntensityScale` / `setEffectIntensityScale`).
 * No useState — state lives in the Zustand store. Law 3: raw semantic HTML +
 * Tailwind only (NativeWind interop off), sticky header + close X like
 * legal-page.web.tsx, rounded cards, accessible iOS-style cyan toggle, and a
 * raw range slider for the intensity scale.
 */

// Intensity presets: Low (0.3), Medium (0.6), High (1.0) — verbatim from native.
const PRESETS = [
  { label: "Low", value: 0.3 },
  { label: "Medium", value: 0.6 },
  { label: "High", value: 1.0 },
] as const;

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex w-12 h-7 shrink-0 items-center rounded-full transition-colors outline-none ${
        on ? "bg-[#3FDCFF]" : "bg-white/15"
      }`}
    >
      <span
        className={`inline-block w-5 h-5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wider text-white/60">
      {children}
    </p>
  );
}

export function WeatherAmbianceScreen() {
  const router = useRouter();

  const weatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.weatherAmbianceEnabled,
  );
  const setWeatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.setWeatherAmbianceEnabled,
  );
  const effectIntensityScale = useWeatherFXStore((s) => s.effectIntensityScale);
  const setEffectIntensityScale = useWeatherFXStore(
    (s) => s.setEffectIntensityScale,
  );

  // Active preset = nearest to the current scale (verbatim from native).
  const activePreset = PRESETS.reduce((prev, curr) =>
    Math.abs(curr.value - effectIntensityScale) <
    Math.abs(prev.value - effectIntensityScale)
      ? curr
      : prev,
  );

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Weather Ambiance</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {/* Brand color legend */}
        <div className="mb-6 flex items-center justify-center gap-6">
          <div className="flex flex-col items-center">
            <div
              className="h-8 w-8 flex items-center justify-center rounded-xl"
              style={{ backgroundColor: "rgba(138, 64, 207, 0.15)" }}
            >
              <CloudRain size={16} color="#8A40CF" />
            </div>
            <span className="mt-1 text-[10px] text-white/60">Rain</span>
          </div>
          <div className="flex flex-col items-center">
            <div
              className="h-8 w-8 flex items-center justify-center rounded-xl"
              style={{ backgroundColor: "rgba(63, 220, 255, 0.15)" }}
            >
              <Snowflake size={16} color="#3FDCFF" />
            </div>
            <span className="mt-1 text-[10px] text-white/60">Snow</span>
          </div>
          <div className="flex flex-col items-center">
            <div
              className="h-8 w-8 flex items-center justify-center rounded-xl"
              style={{ backgroundColor: "rgba(252, 37, 58, 0.15)" }}
            >
              <Sun size={16} color="#FC253A" />
            </div>
            <span className="mt-1 text-[10px] text-white/60">Sunny</span>
          </div>
        </div>

        {/* Master toggle */}
        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          <div className="flex items-center justify-between py-3.5 border-b border-white/8 last:border-0">
            <div className="flex-1 pr-4">
              <p className="font-semibold text-white">Weather Effects</p>
              <p className="mt-1 text-sm text-white/60">
                Show cinematic weather effects and ambient sounds on the Events
                tab based on real-time weather
              </p>
            </div>
            <Toggle
              on={weatherAmbianceEnabled}
              onChange={setWeatherAmbianceEnabled}
              label="Weather Effects"
            />
          </div>
        </div>

        {/* Intensity selector */}
        {weatherAmbianceEnabled ? (
          <>
            <SectionLabel>Effect Intensity</SectionLabel>
            <div className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <div className="flex gap-3">
                {PRESETS.map((preset) => {
                  const isActive = activePreset.label === preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setEffectIntensityScale(preset.value)}
                      className={`flex-1 flex items-center justify-center rounded-2xl py-3 text-sm font-semibold transition-colors ${
                        isActive
                          ? "bg-[#3FDCFF] text-[#06070d]"
                          : "border border-white/10 bg-white/4 text-white"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Fine-grained intensity slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={effectIntensityScale}
                onChange={(e) =>
                  setEffectIntensityScale(Number(e.target.value))
                }
                aria-label="Effect intensity"
                className="mt-4 w-full accent-[#3FDCFF] cursor-pointer"
              />
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
                <span>Low</span>
                <span>{Math.round(effectIntensityScale * 100)}%</span>
                <span>High</span>
              </div>

              <p className="mt-3 text-xs text-white/60">
                Controls particle density, audio volume, and post-processing
                intensity. Low is recommended for older devices.
              </p>
            </div>

            <SectionLabel>About</SectionLabel>
            <div className="rounded-2xl bg-white/4 border border-white/10 p-4">
              <p className="text-sm leading-5 text-white/60">
                Weather effects use your device GPU for smooth, cinematic
                visuals. Effects automatically disable when:
              </p>
              <ul className="mt-3 space-y-1 text-sm text-white/60">
                <li className="flex gap-2">
                  <span>&bull;</span>
                  <span>Reduce Motion is enabled in system settings</span>
                </li>
                <li className="flex gap-2">
                  <span>&bull;</span>
                  <span>Low Power Mode is active</span>
                </li>
                <li className="flex gap-2">
                  <span>&bull;</span>
                  <span>Battery drops below 20%</span>
                </li>
              </ul>
              <p className="mt-3 text-sm leading-5 text-white/60">
                A cinematic intro plays once per day when you first open the
                Events tab with active weather.
              </p>
            </div>
          </>
        ) : null}

        <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <p className="text-sm text-white/60">
            Changes are saved automatically and persist across sessions.
          </p>
        </div>
      </main>
    </div>
  );
}
