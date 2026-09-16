"use client";

import { useRouter } from "solito/navigation";
import { X } from "lucide-react";
import {
  usePrivacySettings,
  useUpdatePrivacySettings,
  type PrivacySettings,
} from "@dvnt/app/lib/hooks/use-user-settings";
import {
  useEventsLocationStore,
  useActiveCityVisibility,
} from "@dvnt/app/lib/stores/events-location-store";
import {
  CITY_VISIBILITY_COPY as COPY,
  formatVisibilityExpiry,
  VISIBILITY_DURATIONS,
} from "@dvnt/app/lib/stores/city-discovery-visibility";

type ToggleRow = {
  key: keyof PrivacySettings;
  label: string;
  description: string;
};

const TOGGLES: ToggleRow[] = [
  {
    key: "privateAccount",
    label: "Private Account",
    description: "Only approved followers can see your posts",
  },
  {
    key: "activityStatus",
    label: "Activity Status",
    description: "Show when you were last active",
  },
  {
    key: "readReceipts",
    label: "Read Receipts",
    description: "Let others know when you've read their messages",
  },
  {
    key: "showLikes",
    label: "Show Likes Count",
    description: "Display like counts on your posts",
  },
];

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${
        checked ? "bg-[#3FDCFF]" : "bg-white/15"
      } ${disabled ? "opacity-40" : ""}`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0px)" }}
      />
    </button>
  );
}

/**
 * City discovery visibility — web sibling of `settings/ui/CityVisibilityCard`.
 * Same store, same copy constants, same rules: off by default, bounded by a
 * duration the member picks, revocable in one click, and carrying a city name
 * rather than coordinates, an event or a ticket.
 */
function CityVisibilitySection() {
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const durationId = useEventsLocationStore((s) => s.visibilityDurationId);
  const setDuration = useEventsLocationStore((s) => s.setVisibilityDuration);
  const showMeInCity = useEventsLocationStore((s) => s.showMeInCity);
  const hideMeInCity = useEventsLocationStore((s) => s.hideMeInCity);
  const grant = useActiveCityVisibility();

  const onToggle = (next: boolean) => {
    if (!next) return hideMeInCity();
    if (activeCity) showMeInCity(activeCity);
  };

  return (
    <>
      <h2 className="mt-8 mb-2 px-1 text-sm font-semibold uppercase text-white/50">
        {COPY.sectionTitle}
      </h2>
      <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
        <div className="flex items-center justify-between py-3.5 border-b border-white/8">
          <div className="flex-1 pr-4">
            <p className="font-semibold text-white">{COPY.toggleLabel}</p>
            <p className="mt-1 text-sm text-white/60">
              {COPY.toggleDescription}
            </p>
          </div>
          <Switch
            label={COPY.toggleLabel}
            checked={grant != null}
            disabled={!activeCity && grant == null}
            onChange={onToggle}
          />
        </div>

        <div className="py-4">
          <p className="text-sm font-medium text-white">
            {COPY.durationLabel}
          </p>
          <div className="mt-3 flex gap-2" role="radiogroup">
            {VISIBILITY_DURATIONS.map((d) => {
              const selected = d.id === durationId;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setDuration(d.id)}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    selected
                      ? "border-[#3FDCFF] bg-[#3FDCFF]/10 text-[#3FDCFF]"
                      : "border-white/15 text-white/60"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          {grant ? (
            <div className="mt-4">
              <p className="text-sm text-white/60">
                Members can see you are in {grant.cityName} until{" "}
                {formatVisibilityExpiry(grant.expiresAt, Date.now())}. It turns
                itself off then.
              </p>
              <button
                type="button"
                onClick={hideMeInCity}
                className="mt-3 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white"
              >
                {COPY.revoke}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-white/60">
              {activeCity ? COPY.offNote : COPY.noCity}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Privacy settings — web (faithful port of `app/settings/privacy.tsx`).
 * Data wiring is sacred: `usePrivacySettings` (query hook for prefs) +
 * `useUpdatePrivacySettings` (optimistic mutation). `handleToggle` mirrors the
 * native screen exactly. Sticky header like legal-page.web; iOS-style switches.
 */
export function PrivacyScreen() {
  const router = useRouter();
  const { data: settings, isLoading } = usePrivacySettings();
  const updateMutation = useUpdatePrivacySettings();

  const handleToggle = (key: keyof PrivacySettings, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Privacy</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading settings...</p>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
            {TOGGLES.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between py-3.5 border-b border-white/8 last:border-0"
              >
                <div className="flex-1 pr-4">
                  <p className="font-semibold text-white">{row.label}</p>
                  <p className="mt-1 text-sm text-white/60">{row.description}</p>
                </div>
                <Switch
                  label={row.label}
                  checked={settings?.[row.key] ?? false}
                  onChange={(value) => handleToggle(row.key, value)}
                />
              </div>
            ))}
          </div>

          <CityVisibilitySection />

          <div className="mt-4 rounded-2xl border border-[#3FDCFF]/20 bg-[#3FDCFF]/5 p-4">
            <p className="text-sm text-white/60">
              Changes are saved automatically and will apply immediately.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
