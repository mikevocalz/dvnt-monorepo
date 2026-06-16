"use client";

import { useRouter } from "solito/navigation";
import { X } from "lucide-react";
import {
  useNotificationPrefs,
  useUpdateNotificationPrefs,
  type NotificationPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

/**
 * Push Notifications settings — web (Phase 1 port of native
 * `app/settings/notifications.tsx`). Law 1: faithful to the native data flow —
 * prefs come from `useNotificationPrefs`, every toggle calls
 * `useUpdateNotificationPrefs().mutate({ [key]: value })` exactly like native
 * (optimistic update lives inside the mutation hook). Law 3: raw semantic HTML +
 * Tailwind only (NativeWind interop is off), sticky header + close X like
 * legal-page.web.tsx, rounded cards, accessible iOS-style cyan toggle.
 */

function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex w-12 h-7 shrink-0 items-center rounded-full transition-colors outline-none disabled:opacity-40 ${
        on ? "bg-cyan-500" : "bg-white/15"
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

function Row({
  label,
  description,
  on,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/8 last:border-0">
      <div className="flex-1 pr-4">
        <p className={`font-medium ${disabled ? "text-white/40" : "text-white"}`}>{label}</p>
        {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
      </div>
      <Toggle on={on} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-white/40">
      {children}
    </p>
  );
}

export function NotificationsScreen() {
  const router = useRouter();
  const { data: prefs, isLoading } = useNotificationPrefs();
  const updateMutation = useUpdateNotificationPrefs();

  const handleToggle = (key: keyof NotificationPrefs, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  const pauseAll = prefs?.pauseAll ?? false;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Push Notifications</h1>
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
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading settings...</p>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          {/* Pause All */}
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
            <Row
              label="Pause All"
              description="Temporarily pause all notifications"
              on={pauseAll}
              onChange={(value) => handleToggle("pauseAll", value)}
            />
          </div>

          <SectionLabel>Interactions</SectionLabel>
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
            <Row
              label="Likes"
              on={prefs?.likes ?? true}
              disabled={pauseAll}
              onChange={(value) => handleToggle("likes", value)}
            />
            <Row
              label="Comments"
              on={prefs?.comments ?? true}
              disabled={pauseAll}
              onChange={(value) => handleToggle("comments", value)}
            />
            <Row
              label="New Followers"
              on={prefs?.follows ?? true}
              disabled={pauseAll}
              onChange={(value) => handleToggle("follows", value)}
            />
            <Row
              label="Mentions"
              on={prefs?.mentions ?? true}
              disabled={pauseAll}
              onChange={(value) => handleToggle("mentions", value)}
            />
          </div>

          <SectionLabel>Messages</SectionLabel>
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
            <Row
              label="Direct Messages"
              on={prefs?.messages ?? true}
              disabled={pauseAll}
              onChange={(value) => handleToggle("messages", value)}
            />
          </div>

          <SectionLabel>Other</SectionLabel>
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
            <Row
              label="Live Videos"
              on={prefs?.liveVideos ?? false}
              disabled={pauseAll}
              onChange={(value) => handleToggle("liveVideos", value)}
            />
            <Row
              label="Email Notifications"
              on={prefs?.emailNotifications ?? false}
              onChange={(value) => handleToggle("emailNotifications", value)}
            />
          </div>

          <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-sm text-white/60">
              Changes are saved automatically and will apply immediately.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
