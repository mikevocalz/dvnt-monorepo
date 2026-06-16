"use client";

import { useRouter } from "solito/navigation";
import { Sun, Moon, Smartphone, Check, X } from "lucide-react";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";

/**
 * Theme settings — web (port of native `app/settings/theme.tsx`). Law 1:
 * faithful to the native data flow — the selection persists to the EXACT same
 * `mmkv` store under the EXACT same `app_theme_preference` key, and the live
 * scheme is driven through the EXACT same `useColorScheme().setColorScheme`
 * (nativewind) setter. The selected value is read straight off mmkv (no local
 * useState; the preference lives in the mmkv store) and re-renders track the
 * nativewind `colorScheme` store. Law 3: raw semantic HTML + Tailwind only
 * (NativeWind interop off), sticky header + close X like legal-page.web.tsx,
 * rounded card rows with a cyan Check on the selected option.
 */

type ThemeOption = "system" | "light" | "dark";
const THEME_STORAGE_KEY = "app_theme_preference";

const themes: {
  id: ThemeOption;
  label: string;
  description: string;
  Icon: typeof Sun;
}[] = [
  {
    id: "system",
    label: "System",
    description: "Match your device settings",
    Icon: Smartphone,
  },
  {
    id: "light",
    label: "Light",
    description: "Always use light mode",
    Icon: Sun,
  },
  {
    id: "dark",
    label: "Dark",
    description: "Always use dark mode",
    Icon: Moon,
  },
];

export function ThemeScreen() {
  const router = useRouter();
  const { colorScheme, setColorScheme } = useColorScheme();

  // Selection lives in the mmkv store, not local state. Reading `colorScheme`
  // above subscribes this component to the nativewind store so the active row
  // re-renders the moment `setColorScheme` runs.
  const stored = mmkv.getString(THEME_STORAGE_KEY);
  const selectedTheme: ThemeOption =
    stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : colorScheme === "light"
        ? "light"
        : "dark";

  const handleSelectTheme = (theme: ThemeOption) => {
    mmkv.set(THEME_STORAGE_KEY, theme);
    setColorScheme(theme as Parameters<typeof setColorScheme>[0]);
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Theme</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          {themes.map((theme) => {
            const selected = selectedTheme === theme.id;
            const Icon = theme.Icon;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => handleSelectTheme(theme.id)}
                className="w-full flex items-center py-3.5 border-b border-white/8 last:border-0 text-left active:bg-white/5"
              >
                <span className="mr-4 flex items-center justify-center rounded-xl bg-white/8 p-2">
                  <Icon size={20} color="#fff" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold text-white">{theme.label}</span>
                  <span className="text-sm text-white/60">{theme.description}</span>
                </span>
                {selected ? <Check size={20} color="#3FDCFF" /> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <p className="text-sm text-white/60">
            Theme changes apply immediately and are saved automatically.
          </p>
        </div>
      </main>
    </div>
  );
}
