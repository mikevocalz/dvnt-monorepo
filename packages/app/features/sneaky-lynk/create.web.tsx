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

import { useEffect, useCallback } from "react";
import { useRouter } from "solito/navigation";
import { ArrowLeft, Radio, Video, Globe, Lock, UserPlus, X, Plus } from "lucide-react";
import { FormField } from "@dvnt/ui";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { useLynkHistoryStore } from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { useCreateLynkStore } from "./create-store";

const ACCENT = "#FC253A";
const ROOM_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveCreatedRoomId(room: unknown): string {
  const candidate = room as
    | { id?: unknown; uuid?: unknown; internalId?: unknown }
    | null;
  const ids = [candidate?.uuid, candidate?.id, candidate?.internalId]
    .filter((id): id is string | number => id != null)
    .map((id) => String(id));

  // Prefer a real UUID, but NEVER abort if the response shape differs — the
  // room route + video_join_room both accept the integer id too. Returning ""
  // here used to throw and strand the user on the create screen.
  return ids.find((id) => ROOM_UUID_REGEX.test(id)) ?? ids[0] ?? "";
}

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
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-white/[0.06] rounded-xl px-4 py-4">
      <span className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg bg-[#FC253A]/20 flex items-center justify-center shrink-0">
          {icon}
        </span>
        <span>
          <span className="block text-white font-semibold">{title}</span>
          <span className="block text-xs text-white/60">{subtitle}</span>
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className="relative h-7 w-12 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: value ? ACCENT : "#374151" }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
          style={{ transform: value ? "translateX(24px)" : "translateX(4px)" }}
        />
      </button>
    </div>
  );
}

export function SneakyLynkCreateScreen() {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const addRoom = useLynkHistoryStore((s) => s.addRoom);

  const title = useCreateLynkStore((s) => s.title);
  const description = useCreateLynkStore((s) => s.description);
  const hasVideo = useCreateLynkStore((s) => s.hasVideo);
  const isPublic = useCreateLynkStore((s) => s.isPublic);
  const isCreating = useCreateLynkStore((s) => s.isCreating);
  const inviteSearch = useCreateLynkStore((s) => s.inviteSearch);
  const inviteResults = useCreateLynkStore((s) => s.inviteResults);
  const invitees = useCreateLynkStore((s) => s.invitees);
  const setTitle = useCreateLynkStore((s) => s.setTitle);
  const setDescription = useCreateLynkStore((s) => s.setDescription);
  const setHasVideo = useCreateLynkStore((s) => s.setHasVideo);
  const setIsPublic = useCreateLynkStore((s) => s.setIsPublic);
  const setIsCreating = useCreateLynkStore((s) => s.setIsCreating);
  const setInviteSearch = useCreateLynkStore((s) => s.setInviteSearch);
  const setInviteResults = useCreateLynkStore((s) => s.setInviteResults);
  const addInvitee = useCreateLynkStore((s) => s.addInvitee);
  const removeInvitee = useCreateLynkStore((s) => s.removeInvitee);

  useEffect(() => {
    return () => {
      useCreateLynkStore.getState().reset();
    };
  }, []);

  const selfIds = [authUser?.id, (authUser as any)?.authId, (authUser as any)?.auth_id]
    .filter((id): id is string | number => id != null)
    .map((id) => String(id));

  // Debounced invitee search (private rooms only) — same usersApi.searchUsers
  // call + self/duplicate filtering as native.
  useEffect(() => {
    if (isPublic) {
      setInviteSearch("");
      setInviteResults([]);
      return;
    }
    const query = inviteSearch.trim();
    if (query.length < 2) {
      setInviteResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { docs } = await usersApi.searchUsers(query, 8);
      if (cancelled) return;
      setInviteResults(
        docs
          .map((user: any) => ({
            id: user.id,
            authId: user.authId,
            username: user.username,
            avatar: user.avatar,
          }))
          .filter(
            (user) =>
              user.authId &&
              !selfIds.includes(String(user.authId)) &&
              !selfIds.includes(String(user.id)) &&
              !invitees.some((invitee) => invitee.authId === user.authId),
          ),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteSearch, invitees, isPublic]);

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      showToast("error", "Error", "Please enter a title for your Lynk");
      return;
    }
    setIsCreating(true);
    let didStartNavigation = false;
    try {
      const result = await sneakyLynkApi.createRoom({
        title: title.trim(),
        topic: description.trim() || "Live conversation",
        description: description.trim(),
        hasVideo,
        isPublic,
        invitedUserIds: isPublic ? [] : invitees.map((i) => i.authId),
      });

      if (!result.ok || !result.data) {
        throw new Error(result.error?.message || "Failed to create room");
      }

      const roomId = resolveCreatedRoomId(result.data.room);

      if (!roomId) {
        console.error("[CreateLynk] No room id in create response:", result.data);
        throw new Error("Created Lynk did not return a room id");
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
      didStartNavigation = true;
      const target = `/feed/sneaky-lynk/room/${roomId}?${qs}`;
      router.push(target);
      // Hard-navigation safety net: in this ssr:false dynamic route the SPA
      // push has been getting swallowed (create screen stays put, button reverts
      // to "Start Lynk"). If we're still on /sneaky-lynk/create shortly after,
      // force a full navigation so the host ALWAYS lands in their new room.
      if (typeof window !== "undefined") {
        setTimeout(() => {
          if (window.location.pathname.includes("/sneaky-lynk/create")) {
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
      showToast("error", "Error", message);
    } finally {
      if (!didStartNavigation) {
        setIsCreating(false);
      }
    }
  }, [
    title,
    description,
    hasVideo,
    isPublic,
    invitees,
    authUser,
    addRoom,
    router,
    showToast,
    setIsCreating,
  ]);

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
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <span className="flex items-center gap-2">
          <Radio size={20} color={ACCENT} />
          <h1 className="text-[17px] font-semibold">Create Lynk</h1>
        </span>
        <span className="w-9" />
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5 pb-16">
        {/* Pricing banner */}
        <section
          className="rounded-2xl p-4 border"
          style={{
            backgroundColor: "rgba(252, 37, 58, 0.08)",
            borderColor: "rgba(252, 37, 58, 0.2)",
          }}
        >
          <p className="text-base font-bold mb-1">{getLynkDisplayName()}</p>
          <p className="text-sm text-white/60 leading-5">
            Host a private video room for your crew. Rooms with fewer than 5 people under 5
            minutes are completely free.
          </p>
          <div className="flex gap-3 mt-3">
            <div className="flex-1 rounded-xl p-3 bg-white/5">
              <p className="text-xs font-bold">$15 / mo</p>
              <p className="text-[11px] text-white/60 mt-0.5">Up to 15 screens</p>
            </div>
            <div className="flex-1 rounded-xl p-3 bg-white/5">
              <p className="text-xs font-bold">$25 / mo</p>
              <p className="text-[11px] text-white/60 mt-0.5">Unlimited screens</p>
            </div>
          </div>
        </section>

        {/* Title */}
        <FormField label="Title" required htmlFor="lynk-title">
          <input
            id="lynk-title"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="What's your Lynk about?"
            maxLength={100}
            className={inputCls}
          />
          <span className="text-xs text-white/40 text-right">{title.length}/100</span>
        </FormField>

        {/* Description */}
        <FormField label="Description (optional)" htmlFor="lynk-desc">
          <textarea
            id="lynk-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 280))}
            placeholder="Tell people what to expect..."
            rows={3}
            maxLength={280}
            className={`${inputCls} min-h-[100px] resize-y`}
          />
          <span className="text-xs text-white/40 text-right">{description.length}/280</span>
        </FormField>

        {/* Video toggle */}
        <ToggleRow
          icon={<Video size={20} color={ACCENT} />}
          title="Enable Video"
          subtitle="Allow speakers to share video"
          value={hasVideo}
          onChange={setHasVideo}
        />

        {/* Public/Private toggle */}
        <ToggleRow
          icon={
            isPublic ? <Globe size={20} color={ACCENT} /> : <Lock size={20} color={ACCENT} />
          }
          title={isPublic ? "Public Lynk" : "Private Lynk"}
          subtitle={isPublic ? "Anyone can join and listen" : "Only invited users can join"}
          value={isPublic}
          onChange={setIsPublic}
        />

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
                    className="flex items-center gap-2 bg-[#06070d] px-3 py-1.5 rounded-full"
                  >
                    <SquareAvatar uri={invitee.avatar} username={invitee.username} size={20} />
                    <span className="text-sm">@{invitee.username}</span>
                    <button
                      type="button"
                      onClick={() => removeInvitee(invitee.authId)}
                      aria-label={`Remove ${invitee.username}`}
                    >
                      <X size={12} className="text-white/60" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <input
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Search by username..."
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full py-2.5 text-[15px] text-white placeholder:text-white/40 bg-transparent outline-none"
            />

            {inviteResults.length > 0 ? (
              <div className="mt-2 border-t border-white/10 pt-2">
                {inviteResults.map((user) => (
                  <button
                    key={user.authId}
                    type="button"
                    onClick={() => addInvitee(user)}
                    className="flex w-full items-center gap-3 py-2.5 text-left active:bg-white/5"
                  >
                    <SquareAvatar uri={user.avatar} username={user.username} size={32} />
                    <span className="flex-1 text-sm font-semibold">@{user.username}</span>
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

        {/* Create button */}
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate}
          className="py-4 rounded-full text-center font-bold text-base text-white disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {isCreating ? "Creating..." : "Start Lynk"}
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
