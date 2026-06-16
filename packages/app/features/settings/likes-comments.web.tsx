"use client";

import { useRouter } from "solito/navigation";
import { X } from "lucide-react";
import {
  useLikesCommentsPrefs,
  useUpdateLikesCommentsPrefs,
  type LikesCommentsPrefs,
} from "@dvnt/app/lib/hooks/use-user-settings";

/**
 * Likes & Comments settings — web (Phase 1 port of `app/settings/likes-comments.tsx`).
 * Law 2: data wiring is sacred — `useLikesCommentsPrefs` + `useUpdateLikesCommentsPrefs`
 * with the verbatim `handleToggle` mutation. Law 1/3: raw semantic HTML + Tailwind,
 * sticky header like legal-page.web, cards + iOS-style switches.
 */
export function LikesCommentsScreen() {
  const router = useRouter();
  const { data: prefs, isLoading } = useLikesCommentsPrefs();
  const updateMutation = useUpdateLikesCommentsPrefs();

  const handleToggle = (key: keyof LikesCommentsPrefs, value: boolean) => {
    updateMutation.mutate({ [key]: value });
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Likes and Comments</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <span
            aria-label="Loading"
            className="inline-block w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-400 animate-spin"
          />
        </div>
      ) : (
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          <SectionLabel>Likes</SectionLabel>
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4 mb-6">
            <ToggleRow
              title="Hide Like Counts"
              description="Hide like counts on posts from others"
              checked={prefs.hideLikeCounts}
              onToggle={(v) => handleToggle("hideLikeCounts", v)}
            />
          </div>

          <SectionLabel>Comments</SectionLabel>
          <div className="rounded-2xl bg-white/4 border border-white/10 px-4 mb-6">
            <ToggleRow
              title="Allow Comments"
              description="Let others comment on your posts"
              checked={prefs.allowComments}
              onToggle={(v) => handleToggle("allowComments", v)}
            />
            <ToggleRow
              title="Filter Offensive Comments"
              description="Hide comments that may be offensive"
              checked={prefs.filterComments}
              onToggle={(v) => handleToggle("filterComments", v)}
            />
            <ToggleRow
              title="Manual Filter"
              description="Hide comments with specific words"
              checked={prefs.manualFilter}
              onToggle={(v) => handleToggle("manualFilter", v)}
            />
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <p className="text-sm text-white/60">
              Changes are saved automatically and will apply immediately.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
      {children}
    </p>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/8 last:border-0">
      <div className="flex-1 pr-4">
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm text-white/60">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onToggle(!checked)}
        className="relative w-12 h-7 rounded-full transition-colors shrink-0"
        style={{ backgroundColor: checked ? "#3FDCFF" : "rgba(255,255,255,0.16)" }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(0px)" }}
        />
      </button>
    </div>
  );
}
