"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Camera, ArrowUpRight, ImagePlus, PenLine, Sparkles } from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { syncAuthUser } from "@dvnt/app/lib/api/privileged";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVerifiedOnlyPromptStore } from "@dvnt/app/lib/auth/verified-only-prompt";
import {
  canShowProfileReminderAt,
  missingProfileSteps,
  type ReminderNeeds,
} from "@dvnt/app/lib/profile/profile-reminder-policy";

const seenInMemory = new Set<string>();

/**
 * One entry-time reminder per signed-in member per browser-tab session.
 * - Only after auth hydration and an up-to-date own-profile read.
 * - Non-blocking and dismissible, never on verification/checkout/call routes.
 * - Avoids flashing when the latest DB profile already has a photo/post.
 * - A new tab/session can remind again if the profile remains incomplete.
 * - No authentication, ticketing or verification rules are changed.
 */
export function ProfileCompletionPopupHost() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const verificationPopupOpen = useVerifiedOnlyPromptStore((s) => s.open);
  const [needs, setNeeds] = useState<ReminderNeeds>({ photo: false, firstPost: false });
  const [open, setOpen] = useState(false);
  const tried = useRef<string | null>(null);

  const memberId = user?.authId || String(user?.id ?? "");
  const ready = hydrated && isAuthenticated && !!memberId;
  const allowed = canShowProfileReminderAt(pathname);

  useEffect(() => {
    // Avoid drawing a popup over onboarding, email/ID verification, a
    // transaction or a live video room (including deep-linked entry).
    if (!ready || !allowed || verificationPopupOpen || !user) return;

    const key = `dvnt:profile-reminder:v1:${memberId}`;
    if (tried.current === key || seenInMemory.has(key)) return;
    try {
      if (sessionStorage.getItem(key) === "shown") {
        seenInMemory.add(key);
        return;
      }
    } catch {
      // Privacy mode can disable storage; the in-memory per-tab cap still works.
    }
    tried.current = key;
    let cancelled = false;
    void (async () => {
      try {
        // Do not trust persisted postsCount/avatar: it can lag behind a save.\n        // The Better Auth-protected sync endpoint avoids the web JWT-bridge\n        // timing race that can make a direct PostgREST profile read 401.
        const latest = await syncAuthUser();
        if (cancelled || !latest) return; // unavailable != incomplete
        const missing = missingProfileSteps(latest);
        if (!missing.photo && !missing.firstPost) return;
        seenInMemory.add(key);
        try { sessionStorage.setItem(key, "shown"); } catch { /* optional */ }
        setNeeds(missing);
        setOpen(true);
      } catch {
        // Fail quietly on a transient profile-fetch error. Never show a false
        // "blank profile" warning based only on a stale local fallback.
      }
    })();
    return () => { cancelled = true; };
  }, [ready, allowed, memberId, verificationPopupOpen]);

  useEffect(() => {
    if (!ready || !allowed) setOpen(false);
  }, [ready, allowed]);

  // Profile store may update while the dialog is open (e.g. another tab).
  // Local updates make it disappear immediately; reload rechecks server data.
  useEffect(() => {
    if (!open || !user) return;
    if (needs.photo && !!String(user.avatar ?? "").trim()) {
      setNeeds((prev) => ({ ...prev, photo: false }));
    }
    if (needs.firstPost && Number(user.postsCount) > 0) {
      setNeeds((prev) => ({ ...prev, firstPost: false }));
    }
  }, [open, user?.avatar, user?.postsCount, needs.photo, needs.firstPost]);

  const close = () => setOpen(false);
  const navigate = (to: string) => {
    close();
    router.push(to);
  };

  if (!ready || !allowed || !needs.photo && !needs.firstPost) return null;

  return (
    <Dialog open={open && !verificationPopupOpen} onClose={close} hideClose maxWidth={460}>
      <div className="flex flex-col gap-5 py-2 text-white" data-testid="profile-completion-popup">
        <div className="flex items-start justify-between gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#FF5BFC]/30 bg-[#FF5BFC]/12">
            {needs.photo ? <Camera size={26} color="#FF5BFC" /> : <Sparkles size={26} color="#3FDCFF" />}
          </div>
          <span className="rounded-full border border-white/15 bg-white/7 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/65">
            DVNT Community
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-black uppercase tracking-[0.26em] text-[#3FDCFF]">Make your entrance</p>
          <h2 className="text-[clamp(1.65rem,5vw,2.25rem)] leading-[1.09] font-black tracking-tight">
            {needs.photo ? "Don't be a mystery. 📸" : "Your first post is calling. ✨"}
          </h2>
          <p className="text-sm leading-6 text-white/75">
            {needs.photo
              ? "Blank profiles aren't allowed on DVNT. Add a real profile photo so the community knows who they're connecting with."
              : "You're part of the DVNT community. Say hello, share your look, or tell everybody about an event."}
          </p>
        </div>

        <div className="space-y-2.5">
          {needs.photo && (
            <button type="button" onClick={() => navigate("/feed/profile/edit")}
              className="flex min-h-13 w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#35D2EF] to-[#B75BE8] px-4 py-3 text-left text-[15px] font-extrabold text-[#07040C] transition-transform hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35D2EF]">
              <span className="flex items-center gap-3"><ImagePlus size={20} aria-hidden="true" /> Add my profile picture</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          )}
          {needs.firstPost && (
            <button type="button" onClick={() => navigate("/feed/create")}
              className="flex min-h-13 w-full items-center justify-between gap-3 rounded-2xl border border-[#FF5BFC]/45 bg-[#FF5BFC]/12 px-4 py-3 text-left text-[15px] font-extrabold text-white transition-colors hover:bg-[#FF5BFC]/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF5BFC]">
              <span className="flex items-center gap-3"><PenLine size={20} aria-hidden="true" /> Create my first post</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <button type="button" onClick={close}
          className="min-h-11 w-full rounded-xl px-4 py-2 text-sm font-semibold text-white/65 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="Remind me later">
          Remind me later
        </button>
        <p className="text-center text-xs text-white/45">
          This reminder goes away once you've completed these steps.
        </p>
      </div>
    </Dialog>
  );
}
