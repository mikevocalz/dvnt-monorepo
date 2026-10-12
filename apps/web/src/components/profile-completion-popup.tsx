"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Camera, CheckCircle2, ImagePlus, PenLine, Sparkles } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import {
  fetchNewMemberProgress,
  type NewMemberStep,
} from "@dvnt/app/lib/profile/new-member-progress";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVerifiedOnlyPromptStore } from "@dvnt/app/lib/auth/verified-only-prompt";
import {
  canShowProfileReminderAt,
  type ReminderNeeds,
} from "@dvnt/app/lib/profile/profile-reminder-policy";

/**
 * Required profile-entry gate for every signed-in DVNT member.
 *
 * Server evidence is authoritative: the dialog remains until the account has a
 * saved profile photo AND at least one published post. It has no X, no "later",
 * no Escape/backdrop dismissal, and no session/local-storage bypass.
 *
 * Completion routes and purchase/verification flows remain usable so the gate
 * cannot trap somebody away from the exact action they need to finish.
 */
export function ProfileCompletionPopup() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const verificationPopupOpen = useVerifiedOnlyPromptStore((s) => s.open);

  const [needs, setNeeds] = useState<ReminderNeeds>({ photo: false, firstPost: false });
  const [gateStep, setGateStep] = useState<NewMemberStep>("not_required");
  const [checked, setChecked] = useState(false);
  const [gateError, setGateError] = useState(false);
  const [reload, setReload] = useState(0);

  const memberId = user?.authId || String(user?.id ?? "");
  const ready = hydrated && isAuthenticated && !!memberId;
  const allowed = canShowProfileReminderAt(pathname);

  useEffect(() => {
    if (!ready || pathname.startsWith("/auth/")) {
      setChecked(false);
      setGateError(false);
      setNeeds({ photo: false, firstPost: false });
      setGateStep("not_required");
      return;
    }

    let cancelled = false;
    setGateError(false);

    void fetchNewMemberProgress()
      .then((progress) => {
        if (cancelled) return;
        setGateStep(progress.step);
        // Verification-era signups must finish the existing 18+/email flow
        // first. The verified-only/auth UI owns that stage; this dialog begins
        // only once the member can actually complete photo -> first post.
        if (progress.step === "pending_verification") {
          setNeeds({ photo: false, firstPost: false });
        } else {
          setNeeds({
            photo: !progress.hasPhoto,
            firstPost: !progress.hasPost,
          });
        }
        setChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        // A failed status read is not proof of completion. On ordinary app
        // surfaces we fail closed and offer a retry instead of silently letting
        // an incomplete profile bypass the required setup.
        setGateError(true);
        setChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, memberId, pathname, reload]);

  const incomplete = needs.photo || needs.firstPost;
  const modalOpen =
    ready &&
    allowed &&
    checked &&
    !gateError &&
    incomplete &&
    !verificationPopupOpen;

  // On an eligible app surface, unknown server state must not become a bypass.
  if (ready && allowed && checked && gateError) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#06070d] p-6 text-white"
      >
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-[#FF5BFC]">
            DVNT · Required setup
          </p>
          <h2 className="text-2xl font-black">We couldn't confirm your profile yet.</h2>
          <p className="text-sm leading-6 text-white/70">
            Reconnect so DVNT can verify your profile picture and first post.
          </p>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="min-h-12 w-full rounded-xl bg-[#FF5BFC] px-6 py-3 font-bold text-black"
          >
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  if (!ready || !allowed || !checked || !incomplete) return null;

  const photoDone = !needs.photo;
  const postDone = !needs.firstPost;
  const nextIsPhoto = gateStep === "photo" || needs.photo;
  const action = nextIsPhoto
    ? {
        label: "Add my profile picture",
        to: "/feed/onboarding/photo",
        icon: <ImagePlus size={20} aria-hidden="true" />,
      }
    : {
        label: "Create my first post",
        to: "/feed/create",
        icon: <PenLine size={20} aria-hidden="true" />,
      };

  return (
    <Dialog
      open={modalOpen}
      onClose={() => {}}
      hideClose
      dismissible={false}
      maxWidth={460}
    >
      <div
        className="flex flex-col gap-5 py-2 text-white"
        data-testid="profile-completion-popup"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#FF5BFC]/30 bg-[#FF5BFC]/12">
            {nextIsPhoto ? (
              <Camera size={26} color="#FF5BFC" aria-hidden="true" />
            ) : (
              <Sparkles size={26} color="#3FDCFF" aria-hidden="true" />
            )}
          </div>
          <span className="rounded-full border border-white/15 bg-white/7 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/65">
            Required setup
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-[0.26em] text-[#3FDCFF]">
            Make your entrance
          </p>
          <h2 className="text-[clamp(1.65rem,5vw,2.25rem)] leading-[1.09] font-black tracking-tight">
            Two things, then you're in.
          </h2>
          <p className="text-sm leading-6 text-white/75">
            Every DVNT member needs a profile picture and a first post. Once both are
            complete, the rest of DVNT unlocks automatically.
          </p>
        </div>

        <div className="space-y-2.5" aria-label="Required profile steps">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
            {photoDone ? (
              <CheckCircle2 size={20} className="text-emerald-300" aria-hidden="true" />
            ) : (
              <Camera size={20} className="text-[#3FDCFF]" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-bold">Profile picture</p>
              <p className="text-xs text-white/55">{photoDone ? "Complete" : "Required"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5">
            {postDone ? (
              <CheckCircle2 size={20} className="text-emerald-300" aria-hidden="true" />
            ) : (
              <PenLine size={20} className="text-[#FF5BFC]" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-bold">First post</p>
              <p className="text-xs text-white/55">{postDone ? "Complete" : "Required"}</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          data-autofocus
          onClick={() => router.push(action.to)}
          className="flex min-h-13 w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#35D2EF] to-[#B75BE8] px-4 py-3 text-left text-[15px] font-extrabold text-[#07040C] transition-transform hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35D2EF]"
        >
          <span className="flex items-center gap-3">
            {action.icon}
            {action.label}
          </span>
          <ArrowUpRight size={18} aria-hidden="true" />
        </button>

        <p className="text-center text-xs text-white/45">
          This window closes automatically after both required steps are complete.
        </p>
      </div>
    </Dialog>
  );
}
