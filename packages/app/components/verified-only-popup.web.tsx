"use client";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import {
  VERIFIED_ONLY_COPY as COPY,
  canVerify,
  useVerifiedOnlyPromptStore,
} from "@dvnt/app/lib/auth/verified-only-prompt";
import { useVerifiedAdmission } from "@dvnt/app/lib/hooks/use-verified-admission";
import { useVerifiedOnlyRefusalObserver } from "@dvnt/app/lib/hooks/use-verified-only-refusal-observer";
import { useBeginVerification } from "@dvnt/app/lib/hooks/use-begin-verification";

const TITLE_ID = "verified-only-popup-title";

/**
 * The verified-only popup (web). Mounted once in the frontend root layout;
 * opened through `useVerifiedOnlyPromptStore`. Esc and the backdrop close it,
 * focus starts on the primary action and stays inside until it closes.
 */
export function VerifiedOnlyPopup() {
  useVerifiedOnlyRefusalObserver();
  const open = useVerifiedOnlyPromptStore((s) => s.open);
  const storedReason = useVerifiedOnlyPromptStore((s) => s.reason);
  const close = useVerifiedOnlyPromptStore((s) => s.close);
  const dismiss = useVerifiedOnlyPromptStore((s) => s.dismiss);
  const { data: verdict } = useVerifiedAdmission();
  const { begin, start, opened } = useBeginVerification();

  const reason = verdict && verdict.state !== "allowed" ? verdict.reason : storedReason;
  const showVerify = canVerify(reason);

  return (
    <Dialog open={open} onClose={close} hideClose maxWidth={400} labelledBy={TITLE_ID}>
      <div className="flex flex-col gap-5 pt-2 text-white">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(255,91,252,0.14)]">
          <ShieldAlert size={22} color="#FF5BFC" aria-hidden />
        </span>

        <div className="flex flex-col gap-2.5">
          <h2 id={TITLE_ID} className="text-[34px] font-black leading-none tracking-tight">
            {COPY.title}
          </h2>
          <p className="text-[17px] font-bold leading-6">{COPY.lines[0]}</p>
          <p className="text-[15px] leading-[22px] text-[#c9cfdb]">{COPY.lines[1]}</p>
          <p className="text-[15px] leading-[22px] text-[#c9cfdb]">{COPY.lines[2]}</p>
        </div>

        {start.isError ? (
          <p role="alert" className="text-sm text-rose-400">
            {(start.error as Error)?.message || "Couldn't start verification"}. Try again.
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {showVerify ? (
            <button
              type="button"
              data-autofocus
              onClick={begin}
              disabled={start.isPending}
              aria-busy={start.isPending}
              className="min-h-12 rounded-[14px] bg-[#FF5BFC] px-4 text-base font-extrabold text-[#0a0408] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#101321] disabled:opacity-60"
            >
              {start.isPending ? "Starting…" : opened ? COPY.continueVerifying : COPY.verify}
            </button>
          ) : null}
          <button
            type="button"
            data-autofocus={showVerify ? undefined : true}
            onClick={dismiss}
            className="min-h-11 rounded-[14px] px-4 text-[15px] font-bold text-[#c9cfdb] outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-white"
          >
            {COPY.dismiss}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
