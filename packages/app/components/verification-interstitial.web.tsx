"use client";

import { ShieldCheck, Camera } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import {
  useStartVerification,
  useRefreshVerificationStatus,
  type AgeVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

/**
 * B3 interstitial — "Quick verify — about a minute". Shown at the FIRST
 * age-gated RSVP/ticket action, never at registration. The capture itself is
 * Didit's hosted flow (native auto-capture, glare rejection, DOB extracted
 * from the document); this dialog is the framing + failure recovery.
 * Tokens per docs/design-language-audit.md.
 */
export function VerificationInterstitial({
  open,
  onClose,
  status,
  ageLabel,
}: {
  open: boolean;
  onClose: () => void;
  status: AgeVerificationStatus | undefined;
  ageLabel: string;
}) {
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();

  const failed = status === "failed" || status === "expired";
  const inReview = status === "submitted" || status === "review" || status === "pending";

  const beginCapture = async () => {
    try {
      const result = await start.mutateAsync({
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });
      if (result.status === "passed") {
        onClose();
        return;
      }
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        window.open(result.url, "_blank", "noopener");
      }
    } catch {
      // start.isError renders the inline error below — no dead end.
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Quick verify — about a minute">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(62,164,229,0.4)] bg-[rgba(62,164,229,0.16)]">
            <ShieldCheck size={24} color="rgb(62,164,229)" />
          </span>
          <p className="text-sm leading-6 text-white/65">
            This event is {ageLabel}. Scan your ID once — your camera does the
            work, your date of birth comes off the document, and you never see
            this again.
          </p>
        </div>

        {inReview ? (
          <p className="text-sm leading-6 text-white/75 rounded-xl bg-white/4 border border-white/10 p-3">
            Your ID is processing — usually under a minute. Come back and tap
            RSVP again once it's done.
          </p>
        ) : null}

        {failed ? (
          <p className="text-sm leading-6 text-rose-400 rounded-xl bg-white/4 border border-white/10 p-3">
            That scan didn't go through. Try again with better lighting and the
            whole document in frame.
          </p>
        ) : null}

        {start.isError ? (
          <p className="text-sm leading-5 text-rose-400">
            {(start.error as Error)?.message || "Couldn't start verification"} —
            try again.
          </p>
        ) : null}

        <button
          onClick={beginCapture}
          disabled={start.isPending}
          className="flex items-center justify-center gap-2 rounded-xl bg-[rgb(62,164,229)] py-3 font-semibold text-white disabled:opacity-50"
        >
          <Camera size={18} />
          {start.isPending
            ? "Starting…"
            : failed
              ? "Try the scan again"
              : "Verify with ID"}
        </button>

        {inReview ? (
          <button
            onClick={() => {
              void refresh();
              onboardingCheckpoint("verification.status_refreshed");
            }}
            className="py-1 text-center text-sm font-semibold text-white/55"
          >
            Check again
          </button>
        ) : (
          <button
            onClick={() => {
              onboardingCheckpoint("verification.dismissed");
              onClose();
            }}
            className="py-1 text-center text-sm font-semibold text-white/55"
          >
            Not now
          </button>
        )}

        <p className="text-xs leading-5 text-white/40">
          Private — your ID is checked by our verification partner and never
          shown on your profile.
        </p>
      </div>
    </Dialog>
  );
}
