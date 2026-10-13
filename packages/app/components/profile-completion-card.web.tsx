"use client";

import { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useOnboardingV2Store } from "@dvnt/app/lib/stores/onboarding-v2-store";
import { useProfileCompletion } from "@dvnt/app/lib/hooks/use-profile-completion";
import type { CompletionProfile } from "@dvnt/app/lib/profile/completion-sources";

/**
 * B2 completion mechanism: weighted ring + the 3 highest-value missing items
 * with one-tap jumps. Hidden at 100%. Tokens from docs/design-language-audit.md
 * (white/4 card, P ring, pink at complete-adjacent, sentence-case copy).
 */
export function ProfileCompletionCard({
  profile,
  onJump,
}: {
  profile?: CompletionProfile | null;
  onJump: (route: string) => void;
}) {
  const completion = useProfileCompletion(profile);
  const percent = completion?.percent;
  const missing = completion?.missing ?? [];
  const requestNudge = useOnboardingV2Store((s) => s.requestNudge);

  // The session-capped nudge: fires at most once per app session, only while
  // the profile is genuinely thin. The cap lives in the store, not here.
  useEffect(() => {
    if (percent !== undefined && percent < 60 && missing.length > 0) requestNudge();
  }, [percent, missing.length, requestNudge]);

  if (percent === undefined || percent >= 100) return null;

  const R = 20;
  const C = 2 * Math.PI * R;
  const topMissing = missing.slice(0, 3);

  return (
    <div className="mt-5 rounded-2xl bg-white/4 border border-white/10 p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-14 shrink-0" aria-hidden>
          <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90">
            <circle cx="24" cy="24" r={R} fill="none" strokeWidth="4" stroke="rgba(255,255,255,0.1)" />
            <circle
              cx="24"
              cy="24"
              r={R}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              stroke={percent >= 80 ? "#FF5BFC" : "rgb(62,164,229)"}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - percent / 100)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
            {percent}%
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white text-[15px]">Finish your profile</p>
          <p className="text-sm text-white/55">
            A complete profile gets you recognized at events.
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col">
        {topMissing.map((item) => (
          <li key={item.key}>
            <button
              onClick={() => {
                onJump(`${item.route}?focus=${item.key}`);
              }}
              className="flex w-full items-center justify-between py-2.5 text-left text-sm text-white/80 border-t border-white/8"
            >
              <span className="truncate pr-3">{item.label}</span>
              <ChevronRight size={16} className="shrink-0 text-white/40" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
