"use client";

import { useRouter } from "solito/navigation";
import { X } from "lucide-react";
import {
  useMessagesPrefs,
  useUpdateMessagesPrefs,
  type MessagesPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
        checked ? "bg-[#3FDCFF]" : "bg-white/15"
      }`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0px)" }}
      />
    </button>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/8 last:border-0">
      <div className="flex-1 pr-4">
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-white/60">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
      {children}
    </p>
  );
}

/**
 * Messages settings — web (Phase 1 port of `app/settings/messages.tsx`).
 * Law 1: faithful to the native data flow — `useMessagesPrefs` →
 * `useUpdateMessagesPrefs` with the verbatim `handleToggle`. Law 3: raw
 * semantic HTML + Tailwind, sticky header, content column, iOS-switch toggles.
 */
export function MessagesSettingsScreen() {
  const router = useRouter();
  const { data: prefs, isLoading } = useMessagesPrefs();
  const updateMutation = useUpdateMessagesPrefs();

  const handleToggle = (key: keyof MessagesPrefs, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Messages</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex min-h-[60dvh] items-center justify-center">
          <span className="block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
        </div>
      ) : (
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          <SectionLabel>Who Can Message You</SectionLabel>
          <div className="mb-6 rounded-2xl bg-white/4 border border-white/10 px-4">
            <ToggleRow
              title="Allow Messages from Everyone"
              description="Anyone can send you messages directly"
              checked={prefs.allowAll}
              onChange={(v) => handleToggle("allowAll", v)}
            />
            <ToggleRow
              title="Message Requests"
              description="Receive requests from people you don't follow"
              checked={prefs.messageRequests}
              onChange={(v) => handleToggle("messageRequests", v)}
            />
            <ToggleRow
              title="Group Requests"
              description="Allow others to add you to group chats"
              checked={prefs.groupRequests}
              onChange={(v) => handleToggle("groupRequests", v)}
            />
          </div>

          <SectionLabel>Message Settings</SectionLabel>
          <div className="mb-6 rounded-2xl bg-white/4 border border-white/10 px-4">
            <ToggleRow
              title="Read Receipts"
              description="Show when you've read messages"
              checked={prefs.readReceipts}
              onChange={(v) => handleToggle("readReceipts", v)}
            />
          </div>

          <div className="mt-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-sm text-white/60">
              Changes are saved automatically and will apply immediately.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
