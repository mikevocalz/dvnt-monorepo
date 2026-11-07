"use client";

/**
 * Create Lynk — WEB (port of native
 * `app/(protected)/sneaky-lynk/create.tsx`).
 *
 * Law 1 (data is sacred): wires the EXACT native flow —
 *   - `sneakyLynkApi.createRoom({ title, topic, description, hasVideo,
 *     isPublic, invitedUserIds })` (Supabase edge fn `video_create_room`).
 *   - `useLynkHistoryStore.addRoom(...)` so the new room shows on the Lynks
 *     tab (same LynkRecord shape native writes).
 *   - Private-room invitee search via `usersApi.searchUsers(query, 8)`,
 *     debounced + self/duplicate filtering identical to native.
 *   - On success, `router.push` to the new room with the same params.
 *
 * Native-only skipped: `useSneakyLynkCaptureProtection` (native screen-capture
 * guard) and `expo-haptics`. No @stripe / @fishjam native imports.
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) — no
 * <View>/<Text>. Form built with kit `FormField`. State = Zustand
 * (`useCreateLynkStore`, no useState). Avatars are rounded SQUARES (<img>/<div>
 * rounded-lg, never circular). Navigation via solito `useRouter`. bg #06070d,
 * accent cyan #3FDCFF.
 */

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "solito/navigation";
import {
  ArrowLeft,
  Radio,
  Video,
  Globe,
  Lock,
  UserPlus,
  X,
  Plus,
  Smartphone,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { FormField } from "@dvnt/ui";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useLynkCreateScope } from "../hooks/useLynkCreateScope";
import { useLynkInviteSearch } from "../hooks/useLynkInviteSearch";
import { resolveCreatedRoomId, roomInviteeIds } from "../create-room-policy";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import { lynkCreateSummary } from "@dvnt/app/lib/subscription/lynk-create-summary";
import { useLynkHistoryStore } from "../stores/lynk-history-store";
import { sneakyLynkApi } from "../api/supabase";
import { useCreateLynkStore } from "../stores/create-store";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";

const ACCENT = "#FC253A";
// Rounded-SQUARE avatar (never circular, per DVNT rule).
function SquareAvatar({
  uri,
  username,
  size,
}: {
  uri?: string;
  username: string;
  size: number;
}) {
  if (uri) {
    return (
      <img
        src={uri}
        alt={username}
        className="rounded-lg object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-lg bg-white/10 flex items-center justify-center font-semibold text-white/80 shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {(username?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

const inputCls =
  "w-full bg-white/[0.06] border border-white/12 rounded-xl px-4 py-3 text-[15px] text-white placeholder:text-white/40 outline-none focus:border-[#FC253A]/60";

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-white/[0.06] rounded-xl px-4 py-4">
      {/* min-w-0 on both flex children: without it a long title or subtitle
          forces this row past the viewport instead of wrapping. Same guard
          room.web.tsx uses on its participant rows. */}
      <span className="flex min-w-0 items-center gap-3">
        <span className="w-10 h-10 rounded-lg bg-[#FC253A]/20 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-white font-semibold">{title}</span>
          <span className="block text-xs text-white/60">{subtitle}</span>
        </span>
      </span>
      <button
        type="button"
        role="switch"
        // The switch carried no accessible name — a screen reader announced
        // "switch, on" with no clue what it toggles. The row title is the name.
        aria-label={title}
        aria-checked={value}
        disabled={disabled}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50"
        onClick={() => onChange(!value)}
        style={{
          position: "relative",
          width: 48,
          height: 44,
          flexShrink: 0,
          padding: 0,
          border: "none",
          borderRadius: 9999,
          cursor: "pointer",
          backgroundColor: "transparent",
          transition: "background-color 140ms ease",
        }}
      >
        <span aria-hidden="true" style={{ position: "absolute", top: 8, left: 0, width: 48, height: 28, borderRadius: 9999, backgroundColor: value ? ACCENT : "#374151", transition: "background-color 140ms ease" }} />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 12,
            left: 4,
            width: 20,
            height: 20,
            borderRadius: 9999,
            backgroundColor: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
            transition: "transform 140ms ease",
            transform: value ? "translateX(20px)" : "translateX(0px)",
          }}
        />
      </button>
    </div>
  );
}

export function SneakyLynkCreateScreen() {
  const entitlementState = useEntitlements();
  const membership = lynkCreateSummary(entitlementState);
  const creatingRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const addRoom = useLynkHistoryStore((s) => s.addRoom);

  const title = useCreateLynkStore((s) => s.title);
  const description = useCreateLynkStore((s) => s.description);
  const hasVideo = useCreateLynkStore((s) => s.hasVideo);
  const isPublic = useCreateLynkStore((s) => s.isPublic);
  const appOnly = useCreateLynkStore((s) => s.appOnly);
  const isCreating = useCreateLynkStore((s) => s.isCreating);
  const inviteSearch = useCreateLynkStore((s) => s.inviteSearch);
  const createError = useCreateLynkStore((s) => s.createError);
  const setCreateError = useCreateLynkStore((s) => s.setCreateError);
  const invitees = useCreateLynkStore((s) => s.invitees);
  const setTitle = useCreateLynkStore((s) => s.setTitle);
  const setDescription = useCreateLynkStore((s) => s.setDescription);
  const setHasVideo = useCreateLynkStore((s) => s.setHasVideo);
  const setIsPublic = useCreateLynkStore((s) => s.setIsPublic);
  const setAppOnly = useCreateLynkStore((s) => s.setAppOnly);
  const setIsCreating = useCreateLynkStore((s) => s.setIsCreating);
  const setInviteSearch = useCreateLynkStore((s) => s.setInviteSearch);
  const addInvitee = useCreateLynkStore((s) => s.addInvitee);
  const removeInvitee = useCreateLynkStore((s) => s.removeInvitee);

  useEffect(() => {
    return () => {
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
      useCreateLynkStore.getState().reset();
    };
  }, []);

  const captureOwner = useLynkCreateScope(() => {
    draftRevisionRef.current += 1;
    creatingRef.current = false;
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    useCreateLynkStore.getState().reset();
  });

  const handleBack = useCallback(() => {
    captureOwner.revoke();
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    router.back();
  }, [captureOwner, router]);

  useEffect(() => {
    // Browser Back/page departure can happen before the route unmounts.
    const revoke = () => captureOwner.revoke();
    const createPath = window.location.pathname;
    const onHistory = () => {
      // A restored page may receive pageshow followed by popstate. The latter
      // is not a departure when history has restored this same creation route.
      if (window.location.pathname !== createPath) revoke();
    };
    const resume = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // BFCache restores this mounted component, not a new screen instance.
      const hadPendingCreation = creatingRef.current;
      captureOwner.resume();
      creatingRef.current = false;
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
      setIsCreating(false);
      if (hadPendingCreation) {
        setCreateError("Your previous request may have created a Lynk. Check the Lynks tab before starting again.");
      }
    };
    window.addEventListener("popstate", onHistory);
    window.addEventListener("pagehide", revoke);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("pagehide", revoke);
      window.removeEventListener("pageshow", resume);
    };
  }, [captureOwner, setIsCreating, setCreateError]);

  const selfIds = [authUser?.id, (authUser as any)?.authId, (authUser as any)?.auth_id]
    .filter((id): id is string | number => id != null)
    .map((id) => String(id));

  const inviteSearchState = useLynkInviteSearch({ query: inviteSearch, enabled: !isPublic && !isCreating, selfIds, invitees });
  const inviteResults = inviteSearchState.results;
  useEffect(() => { if (isPublic) setInviteSearch(""); }, [isPublic, setInviteSearch]);

  // Verified-only: opening a Lynk needs a verified account.
  const guardVerified = useVerifiedGate();

  const handleCreate = useCallback(async (isCurrent: () => boolean) => {
    if (creatingRef.current || !isCurrent()) return;
    if (!title.trim()) {
      showToast("error", "Error", "Please enter a title for your Lynk");
      return;
    }
    creatingRef.current = true;
    setCreateError(null);
    setIsCreating(true);
    let didStartNavigation = false;
    try {
      const result = await sneakyLynkApi.createRoom({
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        hasVideo,
        isPublic,
        appOnly,
        invitedUserIds: roomInviteeIds(isPublic, invitees),
      }, { isCurrent });

      if (!isCurrent()) return;
      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || "Failed to create room");
      }

      const roomId = resolveCreatedRoomId(result.data.room);

      if (!roomId) {
        console.error("[CreateLynk] No room id in create response:", result.data);
        throw new Error("Your Lynk may have been created, but could not be opened. Check the Lynks tab before trying again.");
      }

      addRoom({
        id: roomId,
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        source: "sneaky_lynk",
        isLive: true,
        hasVideo,
        isPublic,
        status: "open",
        host: {
          id: authUser?.id || "local",
          username: authUser?.username || "You",
          displayName: authUser?.name || authUser?.username || "You",
          avatar: authUser?.avatar || "",
          isVerified: authUser?.isVerified || false,
        },
        speakers: [],
        listeners: 0,
        createdAt: new Date().toISOString(),
      });

      const qs = new URLSearchParams({
        title: title.trim(),
        hasVideo: hasVideo ? "1" : "0",
        isHost: "1",
      }).toString();

      showToast("success", "Lynk Created", "Your Lynk is now live!");
      const target = `/feed/sneaky-lynk/room/${roomId}?${qs}`;
      router.push(target);
      didStartNavigation = true;
      // Hard-navigation safety net: in this ssr:false dynamic route the SPA
      // push has been getting swallowed (create screen stays put, button reverts
      // to "Start Lynk"). If we're still on /sneaky-lynk/create shortly after,
      // force a full navigation so the host ALWAYS lands in their new room.
      if (typeof window !== "undefined") {
        navigationTimer.current = setTimeout(() => {
          if (isCurrent() && window.location.pathname.includes("/sneaky-lynk/create")) {
            window.location.assign(target);
          }
        }, 700);
      }
    } catch (error) {
      console.error("[CreateLynk] Error:", error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to create Lynk";
      if (isCurrent()) {
        setCreateError(message);
        showToast("error", "Couldn’t start Lynk", message);
      }
    } finally {
      if (!didStartNavigation && isCurrent()) {
        creatingRef.current = false;
        setIsCreating(false);
      }
    }
  }, [
    title,
    description,
    hasVideo,
    isPublic,
    appOnly,
    invitees,
    authUser,
    addRoom,
    router,
    showToast,
    setIsCreating,
    setCreateError,
  ]);

  const handleStart = () => {
    const isCurrent = captureOwner(authUser);
    if (creatingRef.current || !isCurrent()) return;
    const reviewedRevision = ++draftRevisionRef.current;
    guardVerified("sneaky_lynk", () => {
      if (isCurrent() && draftRevisionRef.current === reviewedRevision) {
        draftRevisionRef.current += 1; // Consume this exact reviewed intent once.
        void handleCreate(isCurrent);
      }
    });
  };

  const canCreate = !!title.trim() && !isCreating;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="w-11 h-11 rounded-xl bg-white/8 flex items-center justify-center active:scale-95 focus-visible:outline focus-visible:outline-white"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <span className="flex items-center gap-2">
          <Radio size={20} color={ACCENT} />
          <h1 className="text-[17px] font-semibold">Create Lynk</h1>
        </span>
        <span className="w-11" />
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-6 flex flex-col gap-5 pb-16" aria-busy={isCreating}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FC253A]">Your room, your conversation</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Set the tone.</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">Choose who can join and how you want to connect. Your room goes live when you start.</p>
        </div>
        {/* Pricing banner */}
        <section
          className="rounded-2xl p-4 border"
          style={{
            backgroundColor: "rgba(252, 37, 58, 0.08)",
            borderColor: "rgba(252, 37, 58, 0.2)",
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Current membership</p>
          <p className="text-base font-bold mb-1">{membership.title}</p>
          <p className="text-sm text-white/60 leading-5">{membership.description}</p>
          {entitlementState.isError && <button type="button" onClick={entitlementState.refetch} className="mt-3 min-h-11 text-sm font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-white">Retry membership check</button>}
          {membership.benefits.length > 0 && <ul className="mt-3 space-y-1 text-sm text-white/80">
            {membership.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>}
        </section>

        {/* Title */}
        <FormField label="Title" required htmlFor="lynk-title">
          <input
            id="lynk-title"
            disabled={isCreating}
            aria-describedby="lynk-title-count"
            value={title}
            onChange={(e) => { draftRevisionRef.current += 1; setTitle(e.target.value.slice(0, 100)); }}
            placeholder="What's your Lynk about?"
            maxLength={100}
            className={inputCls}
          />
          <span id="lynk-title-count" className="text-xs text-white/50 text-right">{title.length}/100</span>
        </FormField>

        {/* Description */}
        <FormField label="Description (optional)" htmlFor="lynk-desc">
          <textarea
            id="lynk-desc"
            disabled={isCreating}
            aria-describedby="lynk-desc-count"
            value={description}
            onChange={(e) => { draftRevisionRef.current += 1; setDescription(e.target.value.slice(0, 280)); }}
            placeholder="Tell people what to expect..."
            rows={3}
            maxLength={280}
            className={`${inputCls} min-h-[100px] resize-y`}
          />
          <span id="lynk-desc-count" className="text-xs text-white/50 text-right">{description.length}/280</span>
        </FormField>

        {/* Video toggle */}
        <ToggleRow
          disabled={isCreating}
          icon={<Video size={20} color={ACCENT} />}
          title="Enable Video"
          subtitle="Allow speakers to share video"
          value={hasVideo}
          onChange={(value) => { draftRevisionRef.current += 1; setHasVideo(value); }}
        />

        {/* Public/Private toggle */}
        <ToggleRow
          disabled={isCreating}
          icon={
            isPublic ? <Globe size={20} color={ACCENT} /> : <Lock size={20} color={ACCENT} />
          }
          title="Public Lynk"
          subtitle={isPublic ? "Public · Discoverable by the community" : "Private · Invited people and returning members"}
          value={isPublic}
          onChange={(value) => { draftRevisionRef.current += 1; setIsPublic(value); }}
        />

        {/* App-only toggle — the only ENFORCED capture protection. Everything
            the web room does (blackout, shortcut blocking) is
            deterrence; an app-only room simply never mints a peer token for a
            browser. */}
        <ToggleRow
          disabled={isCreating}
          icon={<Smartphone size={20} color={ACCENT} />}
          title="App-only room"
          subtitle="Everyone joins in the DVNT app, including you"
          value={appOnly}
          onChange={(value) => { draftRevisionRef.current += 1; setAppOnly(value); }}
        />
        {appOnly ? (
          <p className="-mt-2 text-xs leading-5 text-white/50">
            Browser access is blocked. The app uses device capture protections where supported,
            but no room can prevent someone recording with another device.
          </p>
        ) : null}

        {/* Invitees (private only) */}
        {!isPublic ? (
          <div className="bg-white/[0.06] rounded-xl px-4 py-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus size={18} className="text-white/60" />
              <span className="text-sm font-semibold">Invite People</span>
            </div>

            {invitees.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {invitees.map((invitee) => (
                  <span
                    key={invitee.authId}
                    className="flex min-w-0 max-w-full items-center gap-2 bg-[#06070d] px-3 py-1.5 rounded-lg"
                  >
                    <SquareAvatar uri={invitee.avatar} username={invitee.username} size={20} />
                    <span className="truncate text-sm">@{invitee.username}</span>
                    <button
                      type="button"
                      disabled={isCreating}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-white"
                      onClick={() => { draftRevisionRef.current += 1; removeInvitee(invitee.authId); }}
                      aria-label={`Remove ${invitee.username}`}
                    >
                      <X size={12} className="text-white/60" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <label htmlFor="lynk-invite-search" className="sr-only">Search people to invite</label>
            <input
              id="lynk-invite-search"
              disabled={isCreating}
              aria-describedby="lynk-search-status"
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Search by username..."
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-lg px-2 py-2.5 text-[15px] text-white placeholder:text-white/40 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#FC253A]/60"
            />

            <div id="lynk-search-status" role="status" aria-live="polite" className="text-sm text-white/60">
              {inviteSearchState.isSearching ? "Searching people…" : inviteSearchState.isError ? "Couldn’t search people. Your selected invitations are saved." : inviteSearchState.isEmpty ? "No more people found. Try another username." : inviteSearch.trim().length < 2 ? "Type at least 2 characters to find people." : null}
              {inviteSearchState.isError && <button type="button" onClick={inviteSearchState.retry} className="ml-2 min-h-11 font-semibold text-white underline underline-offset-4">Try again</button>}
            </div>
            {inviteResults.length > 0 ? (
              <div className="mt-2 border-t border-white/10 pt-2">
                {inviteResults.map((user) => (
                  <button
                    key={user.authId}
                    type="button"
                    disabled={isCreating}
                    aria-label={`Invite ${user.username}`}
                    onClick={() => { draftRevisionRef.current += 1; addInvitee(user); }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg py-2.5 text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-white"
                  >
                    <SquareAvatar uri={user.avatar} username={user.username} size={32} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{user.username}</span>
                    <Plus size={16} color={ACCENT} />
                  </button>
                ))}
              </div>
            ) : null}

            <p className="text-xs text-white/60 mt-2">
              Only the host, co-hosts, previous members, and invited users can join this private
              Lynk.
            </p>
          </div>
        ) : null}

        <section aria-label="Room summary" className="rounded-xl border border-white/10 px-4 py-3">
          <p className="text-sm font-semibold">{hasVideo ? "Audio + video" : "Audio room"} · {isPublic ? "Public" : "Private"}</p>
          <p className="mt-1 text-xs leading-5 text-white/60">{appOnly ? "DVNT app required for everyone." : "Join from the app or a supported browser."}{!isPublic ? ` ${invitees.length} ${invitees.length === 1 ? "person" : "people"} selected to invite.` : ""}</p>
        </section>
        {createError && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm leading-6 text-red-100"><AlertCircle size={18} className="mt-1 shrink-0" /><span>{createError}</span></div>}
        {/* Create button */}
        <button
          type="button"
          onClick={handleStart}
          disabled={!canCreate}
          aria-busy={isCreating}
          className="flex min-h-12 items-center justify-center gap-2 py-4 rounded-lg text-center font-bold text-base text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          style={{ backgroundColor: ACCENT }}
        >
          {isCreating && <Loader2 size={18} className="motion-safe:animate-spin" aria-hidden="true" />}
          {isCreating ? "Starting your Lynk…" : "Start Lynk"}
        </button>

        <p className="text-xs text-white/60 text-center">
          Your Lynk will go live immediately after creation.
          <br />
          You&apos;ll be the host and can invite speakers.
        </p>
      </main>
    </div>
  );
}

export default SneakyLynkCreateScreen;
