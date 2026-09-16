"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  useVerifiedAdmission,
  useAdmissionPromptStore,
} from "@dvnt/app/lib/hooks/use-verified-admission";
import {
  useStartVerification,
  useRefreshVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

/**
 * Verified-only admission prompt, above the feed next to PostUploadStatus.
 * Same states as the native banner: grace is dismissible for this tab session,
 * blocked stays because it explains the next refusal. Nothing renders while
 * enforcement is off.
 */
export function VerifiedAdmissionBanner() {
  const authId = useAuthStore((s) => s.user?.authId);
  const { data: verdict } = useVerifiedAdmission();
  const dismissed = useAdmissionPromptStore((s) => s.dismissed);
  const dismiss = useAdmissionPromptStore((s) => s.dismiss);
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();
  const [opened, setOpened] = useState(false);

  if (!authId || !verdict || verdict.state === "allowed") return null;
  const blocked = verdict.state === "blocked";
  if (!blocked && dismissed.includes(authId)) return null;
  // An under-18 document has no retry: there is nothing to submit again.
  const canVerify = verdict.reason !== "underage";

  const beginCapture = async () => {
    try {
      const result = await start.mutateAsync({
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        window.open(result.url, "_blank", "noopener");
      }
      void refresh();
    } catch {
      // start.isError renders below — no dead end.
    }
  };

  return (
    <section
      aria-live="polite"
      className={`mx-3 my-2 flex flex-col gap-3 rounded-xl border bg-[#161c29] p-3 text-white ${
        blocked ? "border-[rgba(251,113,133,0.4)]" : "border-[rgba(62,164,229,0.35)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck
          size={20}
          className="mt-0.5 shrink-0"
          color={blocked ? "#fb7185" : "rgb(62,164,229)"}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {blocked ? "Verification needed to take part" : "Verify your ID"}
          </p>
          <p className="mt-1 text-sm leading-6 text-white/65">{verdict.message}</p>
        </div>
      </div>

      {start.isError ? (
        <p className="text-sm text-rose-400">
          {(start.error as Error)?.message || "Couldn't start verification"} — try again.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {canVerify ? (
          <button
            onClick={beginCapture}
            disabled={start.isPending}
            className="min-h-11 rounded-lg bg-[rgb(62,164,229)] px-4 font-semibold text-white disabled:opacity-60"
          >
            {start.isPending ? "Starting…" : opened ? "Continue verifying" : "Verify with ID"}
          </button>
        ) : null}
        {blocked ? null : (
          <button
            onClick={() => {
              onboardingCheckpoint("verification.dismissed");
              dismiss(authId);
            }}
            className="min-h-11 px-2 font-semibold text-white/65"
          >
            Not now
          </button>
        )}
      </div>
    </section>
  );
}
