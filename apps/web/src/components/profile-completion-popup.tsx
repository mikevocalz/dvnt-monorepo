"use client";

import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Camera, CheckCircle2, ImagePlus, PenLine, Sparkles } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { useProfileCompletionSession } from "./profile-completion-session";
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

  const memberId = user?.authId || String(user?.id ?? "");
  const ready = hydrated && isAuthenticated && !!memberId;
  const { check, retry } = useProfileCompletionSession(memberId, ready, pathname, verificationPopupOpen);
  const allowed = canShowProfileReminderAt(
    pathname,
    check.status === "ready" ? check.progress.step : undefined,
  );

  // Verification-era signups finish the existing 18+/email UI first. Only a
  // current, successful server read can expose the photo -> first-post stage.
  const needs: ReminderNeeds = check.status === "ready" && check.progress.step !== "pending_verification"
    ? { photo: !check.progress.hasPhoto, firstPost: !check.progress.hasPost }
    : { photo: false, firstPost: false };
  const incomplete = needs.photo || needs.firstPost;
  const modalOpen =
    ready &&
    allowed &&
    check.status === "ready" &&
    incomplete &&
    !verificationPopupOpen;

  // Profile reads run silently. Never interrupt navigation with a loading
  // dialog, including initial hydration, account changes and explicit refreshes.
  // Confirmed missing requirements still use the mandatory setup dialog below.
  if (ready && allowed && check.status === "error" && !verificationPopupOpen) {
    return (
      <Dialog
        key="retry"
        open
        onClose={() => {}}
        hideClose
        dismissible={false}
        maxWidth={460}
        labelledBy="profile-completion-status-title"
      >
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-4 py-2 text-center text-white"
        >
          <p className="text-xs font-black uppercase tracking-[0.3em] text-[#FF5BFC]">
            DVNT · Required setup
          </p>
          <h2
            id="profile-completion-status-title"
            className="text-2xl font-black"
          >
            We couldn't confirm your profile yet.
          </h2>
          <p className="text-sm leading-6 text-white/70">
            Reconnect so DVNT can verify your profile picture and first post.
          </p>
          <button
            type="button"
            data-autofocus
            onClick={retry}
            className="min-h-12 w-full rounded-xl bg-[#FF5BFC] px-6 py-3 font-bold text-black"
          >
            Retry connection
          </button>
          <button
            type="button"
            onClick={() => router.push("/feed/events/my-tickets")}
            className="min-h-11 w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white"
          >
            My tickets
          </button>
        </div>
      </Dialog>
    );
  }

  if (!ready || !allowed || check.status !== "ready" || !incomplete) return null;

  const photoDone = !needs.photo;
  const postDone = !needs.firstPost;
  const nextIsPhoto = needs.photo;
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
      key="required"
      open={modalOpen}
      onClose={() => {}}
      hideClose
      dismissible={false}
      maxWidth={460}
      labelledBy="profile-completion-title"
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
          <h2 id="profile-completion-title" className="text-[clamp(1.65rem,5vw,2.25rem)] leading-[1.09] font-black tracking-tight">
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
        <button
          type="button"
          onClick={() => router.push("/feed/events/my-tickets")}
          className="min-h-11 w-full rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white"
        >
          My tickets
        </button>
      </div>
    </Dialog>
  );
}

