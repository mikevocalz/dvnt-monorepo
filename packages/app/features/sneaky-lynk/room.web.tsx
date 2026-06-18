"use client";

/**
 * Sneaky Lynk Room — WEB (port of native
 * `app/(protected)/sneaky-lynk/room/[id].tsx`).
 *
 * The native room wraps `@fishjam-cloud/react-native-client` (native-only) +
 * VisionCamera + a screen-capture guard. On web we use the REAL web SDK
 * `@fishjam-cloud/react-client` — `FishjamProvider`, `useConnection`,
 * `useCamera`, `useMicrophone`, `usePeers` — exactly like `call.web.tsx`.
 *
 * Law 1 (data is sacred): the PORTABLE sneaky-lynk hooks/mutations are wired
 * verbatim —
 *   - Pre-join lookup: `sneakyLynkApi.getRoomById(id)`.
 *   - Join (peer token): `sneakyLynkApi.joinRoom(id, anonymous)` (Supabase edge
 *     fn `video_join_room`) → { token, peer, user, room } — the SAME token path
 *     native uses.
 *   - `resolveFishjamAppId()` for the FishjamProvider id.
 *   - Hand raise: `sneakyLynkApi.toggleHand(id, raised)`.
 *   - Leave/end: `sneakyLynkApi.leaveRoom(id)` (non-host) /
 *     `sneakyLynkApi.endRoom(id)` (host) + `useLynkHistoryStore.endRoom(...)`.
 *   - Hand-raise / chat / eject domain state = the SHARED `useRoomStore`.
 *
 * Native-only skipped on web: `useSneakyLynkCaptureProtection` /
 * `useSneakyLynkCaptureBroadcast` (screen-capture guard), VisionCamera
 * permissions, expo audio session, AppState host-disconnect guards, the
 * subscription/paywall RN modals.
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) — no
 * <View>/<Text>. State = Zustand (`useRoomUIStore` + shared `useRoomStore`, no
 * useState). LISTS = TanStack Virtual (the listener grid). Avatars are rounded
 * SQUARES. Navigation via solito `useRouter`; `id` via solito `useParams`.
 * bg #06070d, accent cyan #3FDCFF.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import {
  FishjamProvider,
  useConnection,
  useCamera,
  useMicrophone,
  usePeers,
} from "@fishjam-cloud/react-client";
import {
  ArrowLeft,
  Radio,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  Users,
  EyeOff,
  PhoneOff,
  MessageCircle,
  Send,
  Crown,
  UserX,
  VolumeX,
  Clock,
  X,
  Zap,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { videoApi } from "@dvnt/app/src/video/api";
import { useRoomReactions } from "@dvnt/app/src/sneaky-lynk/hooks/useRoomReactions";
import {
  fetchRoomComments,
  postRoomComment,
  subscribeToRoomComments,
  type RoomComment,
} from "@dvnt/app/src/sneaky-lynk/api/comments";
import type { SneakyUser } from "@dvnt/app/src/sneaky-lynk/types";
import { useRoomStore } from "@dvnt/app/src/sneaky-lynk/stores/room-store";
import { useLynkHistoryStore } from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { useRoomUIStore } from "./room-ui-store";

const ACCENT = "#3FDCFF";
const ROSE = "#FC253A";
const PURPLE = "#8A40CF";

/** Free Sneaky Lynk session length — mirrors `FREE_ROOM_DURATION_MS` in the
 *  native `RoomTimer`. Free hosts get a 5-minute countdown then a paywall. */
const FREE_ROOM_DURATION_MS = 5 * 60 * 1000;
const COUNTDOWN_THRESHOLD_MS = 60 * 1000;
const REACTION_EMOJIS = ["❤️", "🔥", "👏", "😮", "😂", "🙌"];

/** A room member as projected for the web moderation panels — the web-safe
 *  shape returned by `videoApi.subscribeToMembers` / `getRoomMembers`. */
interface WebMember {
  userId: string;
  role: string;
  status: string;
  handRaised: boolean;
  username?: string;
  displayName?: string;
  avatar?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

function isClosedRoomError(message?: string | null) {
  if (!message) return false;
  return /no longer open|already ended|has ended|room not found|not found/i.test(message);
}

// ── <video> tile — binds a MediaStream imperatively (no useState) ─────────────
function VideoTile({
  stream,
  muted,
  mirror,
  className,
}: {
  stream: MediaStream | null | undefined;
  muted: boolean;
  mirror?: boolean;
  className: string;
}) {
  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== (stream ?? null)) el.srcObject = stream ?? null;
    },
    [stream],
  );
  return (
    <video
      ref={attach}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

// Rounded-SQUARE avatar (never circular).
function SquareAvatar({
  uri,
  name,
  size,
}: {
  uri?: string;
  name: string;
  size: number;
}) {
  if (uri) {
    return (
      <img
        src={uri}
        alt={name}
        className="rounded-2xl object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-2xl bg-white/10 flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

function ControlButton({
  onClick,
  active,
  danger,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const bg = danger
    ? "bg-rose-500 hover:bg-rose-600"
    : active
      ? "bg-white/15 hover:bg-white/25"
      : "bg-white/30 hover:bg-white/40";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full text-white transition-colors ${bg}`}
    >
      {children}
    </button>
  );
}

type Tile = {
  key: string;
  name: string;
  avatar?: string;
  isLocal: boolean;
  isHost: boolean;
  videoStream: MediaStream | null;
  isCameraOn: boolean;
  isMicOn: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// WEB room hooks — encapsulate the SHARED realtime/data wiring the native
// room mounts via ChatSheet / HandQueueSheet / RoomParticipantsSheet / EjectModal
// (same Supabase channels + edge fns), so the screen body stays declarative.
// useState lives inside these reusable hooks (the useRoomReactions precedent),
// never in the screen component.
// ─────────────────────────────────────────────────────────────────────────────

/** Room chat — `fetchRoomComments` + realtime `subscribeToRoomComments` +
 *  `postRoomComment` (the EXACT data layer the native ChatSheet uses). */
function useRoomChat(roomId: string, currentUser: SneakyUser) {
  const [comments, setComments] = useState<RoomComment[]>([]);

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    void (async () => {
      const initial = await fetchRoomComments(roomId);
      if (active) setComments(initial);
    })();
    const unsubscribe = subscribeToRoomComments(roomId, (incoming) => {
      setComments((prev) =>
        prev.some((c) => c.id === incoming.id) ? prev : [...prev, incoming],
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [roomId]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !currentUser.id) return;
      const optimisticId = -Date.now();
      const author = {
        username: currentUser.username,
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
        isVerified: currentUser.isVerified,
      };
      setComments((prev) => [
        ...prev,
        {
          id: optimisticId,
          roomId,
          authorId: currentUser.id,
          body: trimmed,
          parentId: null,
          rootId: null,
          depth: 0,
          mentions: [],
          createdAt: new Date().toISOString(),
          author,
          isOptimistic: true,
        },
      ]);
      const saved = await postRoomComment({
        roomId,
        authorId: currentUser.id,
        body: trimmed,
        author,
      });
      if (saved) {
        setComments((prev) =>
          prev.map((c) => (c.id === optimisticId ? saved : c)),
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      }
    },
    [roomId, currentUser],
  );

  return { comments, send };
}

/** Member presence + raised-hand sync — `videoApi.getRoomMembers` (initial)
 *  + `videoApi.subscribeToMembers` (realtime). Feeds the hand-queue FIFO
 *  (`setRaisedHands`) + the participants panel, exactly like the native room. */
function useRoomMembersSync(roomId: string, localUserId: string | undefined) {
  const [members, setMembers] = useState<WebMember[]>([]);
  const setRaisedHands = useRoomStore((s) => s.setRaisedHands);

  const syncRaisedHands = useCallback(
    (list: WebMember[]) => {
      const hands: Record<string, boolean> = {};
      for (const m of list) {
        if (m.handRaised && m.status === "active" && m.userId !== localUserId) {
          hands[m.userId] = true;
        }
      }
      setRaisedHands(hands);
    },
    [setRaisedHands, localUserId],
  );

  useEffect(() => {
    if (!roomId) return;
    let active = true;
    void (async () => {
      const initial = await videoApi.getRoomMembers(roomId);
      if (!active) return;
      const mapped: WebMember[] = initial.map((m: any) => ({
        userId: m.userId,
        role: m.role,
        status: m.status ?? "active",
        handRaised: !!m.handRaised,
        username: m.username,
        displayName: m.displayName ?? m.username,
        avatar: m.avatar,
      }));
      setMembers(mapped);
      syncRaisedHands(mapped);
    })();

    const unsubscribe = videoApi.subscribeToMembers(roomId, (member, type) => {
      setMembers((prev) => {
        let next: WebMember[];
        const projected: WebMember = {
          userId: member.userId,
          role: member.role,
          status: member.status ?? "active",
          handRaised: !!member.handRaised,
          username: member.username,
          displayName: (member as any).displayName ?? member.username,
          avatar: member.avatar,
          isAnonymous: (member as any).isAnonymous,
          anonLabel: (member as any).anonLabel,
        };
        if (type === "DELETE" || projected.status !== "active") {
          next = prev.filter((m) => m.userId !== projected.userId);
        } else if (prev.some((m) => m.userId === projected.userId)) {
          next = prev.map((m) =>
            m.userId === projected.userId ? projected : m,
          );
        } else {
          next = [...prev, projected];
        }
        syncRaisedHands(next);
        return next;
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [roomId, syncRaisedHands]);

  return members;
}

/** Eject / room-ended watcher — `videoApi.subscribeToRoomEvents`. When the
 *  host kicks/bans the local user (or ends the room) we surface the native
 *  EjectModal copy as a web banner, then leave. */
function useEjectWatcher(
  roomId: string,
  userId: string | undefined,
  onEject: (reason: string) => void,
) {
  const onEjectRef = useRef(onEject);
  onEjectRef.current = onEject;
  useEffect(() => {
    if (!roomId || !userId) return;
    const unsubscribe = videoApi.subscribeToRoomEvents(
      roomId,
      userId,
      (event) => {
        if (event.type === "room_ended") {
          onEjectRef.current("This Lynk has ended.");
          return;
        }
        if (event.targetId && event.targetId === userId) {
          const action = (event.payload as any)?.action;
          onEjectRef.current(
            action === "ban"
              ? "You were removed from this Lynk by the host."
              : "You were removed from this Lynk.",
          );
        }
      },
    );
    return unsubscribe;
  }, [roomId, userId]);
}

// ── Connection banner (reconnecting / lost) ───────────────────────────────────
function ConnectionBanner({ status }: { status: string }) {
  if (status === "connected" || status === "idle") return null;
  const reconnecting = status === "connecting";
  return (
    <div
      className="absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold"
      style={{
        backgroundColor: reconnecting
          ? "rgba(250, 204, 21, 0.92)"
          : "rgba(252, 37, 58, 0.92)",
        color: reconnecting ? "#1a1a00" : "#fff",
      }}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {reconnecting ? "Reconnecting…" : "Connection lost"}
    </div>
  );
}

// ── Floating reactions overlay (emoji rise + fade) ────────────────────────────
function FloatingReactions({
  reactions,
}: {
  reactions: { id: string; emoji: string }[];
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex justify-center">
      <div className="relative h-40 w-40">
        {reactions.map((r, i) => (
          <span
            key={r.id}
            className="absolute bottom-0 animate-[lynk-float_2.4s_ease-out_forwards] text-3xl"
            style={{ left: `${20 + ((i * 23) % 60)}%` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>
      <style>{`@keyframes lynk-float{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-150px) scale(1.2)}}`}</style>
    </div>
  );
}

// ── Reaction bar (emoji quick-row) ────────────────────────────────────────────
function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/8 px-2 py-1">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSend(emoji)}
          aria-label={`React ${emoji}`}
          className="rounded-full px-1.5 py-0.5 text-lg transition-transform hover:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// ── Side-panel shell (web replacement for native bottom-sheets) ───────────────
function SidePanel({
  open,
  onClose,
  title,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 z-40 bg-black/50 sm:bg-black/30"
      />
      <aside
        className="absolute inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-[#0b0d14] shadow-2xl"
        role="dialog"
        aria-label={title}
      >
        <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <span className="flex items-center gap-2 text-base font-semibold text-white">
            {icon}
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white hover:bg-white/15"
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}

// ── Chat panel (room comments) ────────────────────────────────────────────────
function ChatPanel({
  open,
  onClose,
  comments,
  onSend,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  comments: RoomComment[];
  onSend: (body: string) => void;
  currentUserId: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, comments.length]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      onSend(el.value);
      el.value = "";
    },
    [onSend],
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Chat"
      icon={<MessageCircle size={18} className="text-cyan-400" />}
    >
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {comments.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            No messages yet. Say hi 👋
          </p>
        ) : (
          comments.map((c) => {
            const isOwn = c.authorId === currentUserId;
            return (
              <div key={c.id} className="flex items-start gap-2">
                <SquareAvatar
                  uri={c.author?.avatar}
                  name={c.author?.displayName || c.author?.username || "?"}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold text-white/70">
                    {isOwn ? "You" : c.author?.displayName || c.author?.username || "Guest"}
                  </span>
                  <p
                    className={`mt-0.5 break-words rounded-2xl px-3 py-1.5 text-sm ${
                      isOwn ? "bg-cyan-500/20 text-white" : "bg-white/8 text-white/90"
                    } ${c.isOptimistic ? "opacity-60" : ""}`}
                  >
                    {c.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-white/8 px-3 py-3"
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Message…"
          maxLength={500}
          className="flex-1 rounded-full bg-white/8 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <button
          type="submit"
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500 text-black hover:bg-cyan-400"
        >
          <Send size={18} />
        </button>
      </form>
    </SidePanel>
  );
}

// ── Hand-queue panel (host moderation, FIFO order) ────────────────────────────
function HandQueuePanel({
  open,
  onClose,
  order,
  members,
  onPromote,
}: {
  open: boolean;
  onClose: () => void;
  order: string[];
  members: WebMember[];
  onPromote: (userId: string) => void;
}) {
  const byId = new Map(members.map((m) => [m.userId, m]));
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`Raised hands · ${order.length}`}
      icon={<Hand size={18} className="text-pink-400" />}
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {order.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            No raised hands right now.
          </p>
        ) : (
          order.map((userId, i) => {
            const m = byId.get(userId);
            const name =
              m?.anonLabel || m?.displayName || m?.username || "Guest";
            return (
              <div
                key={userId}
                className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2"
              >
                <span className="text-xs font-bold tabular-nums text-white/40">
                  {i + 1}
                </span>
                <SquareAvatar uri={m?.avatar} name={name} size={36} />
                <span className="flex-1 truncate text-sm font-medium text-white">
                  {name}
                </span>
                <button
                  type="button"
                  onClick={() => onPromote(userId)}
                  className="flex items-center gap-1 rounded-full bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/30"
                >
                  <Crown size={13} /> Bring up
                </button>
              </div>
            );
          })
        )}
      </div>
    </SidePanel>
  );
}

// ── Participants panel (host: mute / promote / remove) ────────────────────────
function ParticipantsPanel({
  open,
  onClose,
  members,
  isHost,
  localUserId,
  onPromote,
  onKick,
  onMute,
}: {
  open: boolean;
  onClose: () => void;
  members: WebMember[];
  isHost: boolean;
  localUserId: string | undefined;
  onPromote: (userId: string) => void;
  onKick: (userId: string) => void;
  onMute: (userId: string) => void;
}) {
  const active = members.filter((m) => m.status === "active");
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`In the room · ${active.length}`}
      icon={<Users size={18} className="text-cyan-400" />}
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {active.map((m) => {
          const name = m.anonLabel || m.displayName || m.username || "Guest";
          const isSelf = m.userId === localUserId;
          const isRoomHost = m.role === "host";
          return (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2"
            >
              <SquareAvatar uri={m.avatar} name={name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">
                  {name}
                  {isSelf ? " (you)" : ""}
                </span>
                {m.role !== "listener" ? (
                  <span className="text-[11px] uppercase tracking-wide text-cyan-400/80">
                    {m.role}
                  </span>
                ) : null}
              </span>
              {isHost && !isSelf && !isRoomHost ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onMute(m.userId)}
                    aria-label="Mute"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
                  >
                    <MicOff size={14} />
                  </button>
                  {m.role !== "co-host" ? (
                    <button
                      type="button"
                      onClick={() => onPromote(m.userId)}
                      aria-label="Promote to co-host"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                    >
                      <Crown size={14} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onKick(m.userId)}
                    aria-label="Remove from room"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  >
                    <UserX size={14} />
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}

// ── Free-host countdown badge (mirrors native RoomTimer) ──────────────────────
function WebRoomTimer({
  startedAt,
  onTimeUp,
}: {
  startedAt: number;
  onTimeUp: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, FREE_ROOM_DURATION_MS - (Date.now() - startedAt)),
  );
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const firedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, FREE_ROOM_DURATION_MS - (Date.now() - startedAt));
      setRemainingMs(remaining);
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(interval);
        onTimeUpRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (remainingMs > COUNTDOWN_THRESHOLD_MS || remainingMs <= 0) return null;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const display = `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60)
    .toString()
    .padStart(2, "0")}`;
  return (
    <span className="flex animate-pulse items-center gap-1.5 rounded-lg bg-rose-500/90 px-2.5 py-1.5 text-[13px] font-bold text-white">
      <Clock size={14} /> {display}
    </span>
  );
}

// ── Duration-limit paywall (web equivalent of SneakySubscriptionModal) ────────
function TimeUpDialog({
  open,
  onUpgrade,
  onLeave,
}: {
  open: boolean;
  onUpgrade: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/70 sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#0b0d14] px-6 pb-10 pt-7 sm:rounded-3xl">
        <span
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundColor: `${PURPLE}20` }}
        >
          <Crown size={26} color={PURPLE} />
        </span>
        <h2 className="text-center text-xl font-bold text-white">Time&apos;s up</h2>
        <p className="mt-2 text-center text-sm text-white/60">
          Your session reached the 5-minute limit on the free plan. Upgrade to
          host bigger, longer Lynks.
        </p>
        <button
          type="button"
          onClick={onUpgrade}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-bold text-white"
          style={{ backgroundColor: PURPLE }}
        >
          <Zap size={16} /> Upgrade plan
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="mt-3 w-full rounded-full bg-white/8 py-3.5 font-semibold text-white/80 hover:bg-white/15"
        >
          Leave Lynk
        </button>
      </div>
    </div>
  );
}

// ── Eject banner (web equivalent of native EjectModal) ────────────────────────
function EjectBanner({ reason, onDismiss }: { reason: string; onDismiss: () => void }) {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 px-6 text-center">
      <div className="w-full max-w-sm">
        <span className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/20">
          <UserX size={32} className="text-rose-400" />
        </span>
        <h2 className="text-xl font-bold text-white">Removed from Lynk</h2>
        <p className="mt-2 text-sm text-white/60">{reason}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-7 w-full rounded-full bg-white/8 py-3.5 font-semibold text-white hover:bg-white/15"
        >
          Back
        </button>
      </div>
    </div>
  );
}

// ── Inner room (rendered INSIDE FishjamProvider so SDK hooks are valid) ───────
function RoomInner({
  id,
  paramTitle,
  roomHasVideo,
  isCreator,
}: {
  id: string;
  paramTitle?: string;
  roomHasVideo: boolean;
  isCreator: boolean;
}) {
  const router = useRouter();
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const endRoomHistory = useLynkHistoryStore((s) => s.endRoom);

  const { joinRoom, leaveRoom, peerStatus } = useConnection();
  const camera = useCamera();
  const microphone = useMicrophone();
  const peers = usePeers();

  // Shared sneaky-lynk room-domain state.
  const isHandRaised = useRoomStore((s) => s.isHandRaised);
  const setIsHandRaised = useRoomStore((s) => s.setIsHandRaised);
  const resetRoomStore = useRoomStore((s) => s.reset);
  const isChatOpen = useRoomStore((s) => s.isChatOpen);
  const openChat = useRoomStore((s) => s.openChat);
  const closeChat = useRoomStore((s) => s.closeChat);
  const isHandQueueOpen = useRoomStore((s) => s.isHandQueueOpen);
  const openHandQueue = useRoomStore((s) => s.openHandQueue);
  const closeHandQueue = useRoomStore((s) => s.closeHandQueue);
  const raisedHandOrder = useRoomStore((s) => s.raisedHandOrder);
  const promoteListener = useRoomStore((s) => s.promoteListener);

  // Web UI/connection phase store (no useState).
  const phase = useRoomUIStore((s) => s.phase);
  const joinAnonymous = useRoomUIStore((s) => s.joinAnonymous);
  const closedReason = useRoomUIStore((s) => s.closedReason);
  const errorMessage = useRoomUIStore((s) => s.errorMessage);
  const isMicOn = useRoomUIStore((s) => s.isMicOn);
  const isCameraOn = useRoomUIStore((s) => s.isCameraOn);
  const initStarted = useRoomUIStore((s) => s.initStarted);
  const roomSnapshot = useRoomUIStore((s) => s.roomSnapshot);
  const setInitStarted = useRoomUIStore((s) => s.setInitStarted);
  const setPhase = useRoomUIStore((s) => s.setPhase);
  const setRoomSnapshot = useRoomUIStore((s) => s.setRoomSnapshot);
  const setClosed = useRoomUIStore((s) => s.setClosed);
  const setErrorState = useRoomUIStore((s) => s.setError);
  const setMicOn = useRoomUIStore((s) => s.setMicOn);
  const setCameraOn = useRoomUIStore((s) => s.setCameraOn);

  // Web-only moderation/paywall surfaces (Law 3: panels/dialogs, not sheets).
  const isParticipantsOpen = useRoomUIStore((s) => s.isParticipantsOpen);
  const setParticipantsOpen = useRoomUIStore((s) => s.setParticipantsOpen);
  const isPaidHost = useRoomUIStore((s) => s.isPaidHost);
  const setIsPaidHost = useRoomUIStore((s) => s.setIsPaidHost);
  const timerStartedAt = useRoomUIStore((s) => s.timerStartedAt);
  const setTimerStartedAt = useRoomUIStore((s) => s.setTimerStartedAt);
  const showTimeUp = useRoomUIStore((s) => s.showTimeUp);
  const setShowTimeUp = useRoomUIStore((s) => s.setShowTimeUp);
  const ejectReason = useRoomUIStore((s) => s.ejectReason);
  const setEjectReason = useRoomUIStore((s) => s.setEjectReason);

  // Stable refs so callbacks/effects never capture stale SDK objects.
  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;
  const leaveRoomRef = useRef(leaveRoom);
  leaveRoomRef.current = leaveRoom;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const micRef = useRef(microphone);
  micRef.current = microphone;
  const isHostRef = useRef(isCreator);

  // Local identity projected as a SneakyUser for reactions/chat authorship.
  const currentUser: SneakyUser = {
    id: authUser?.id ?? "",
    username: joinAnonymous ? "anon" : authUser?.username ?? "you",
    displayName: joinAnonymous ? "Anon" : authUser?.name || authUser?.username || "You",
    avatar: joinAnonymous ? "" : authUser?.avatar ?? "",
    isVerified: false,
    isAnonymous: joinAnonymous,
    anonLabel: joinAnonymous ? "Anon" : null,
  };

  // Shared realtime/data wiring (same channels + edge fns as the native room).
  const { reactions, sendReaction } = useRoomReactions({ roomId: id, currentUser });
  const { comments, send: sendChat } = useRoomChat(id, currentUser);
  const members = useRoomMembersSync(id, authUser?.id);

  useEjectWatcher(id, authUser?.id, (reason) => {
    try {
      leaveRoomRef.current();
    } catch {
      // ignore
    }
    try {
      cameraRef.current.stopCamera();
      micRef.current.stopMicrophone();
    } catch {
      // ignore
    }
    setEjectReason(reason);
  });

  // ── JOIN: sneaky-lynk peer token → Fishjam joinRoom → start media ──────────
  useEffect(() => {
    if (initStarted || !id) return;
    setInitStarted(true);
    let cancelled = false;

    (async () => {
      setPhase("joining");
      const result = await sneakyLynkApi.joinRoom(id, joinAnonymous);
      if (cancelled) return;

      if (!result.ok || !result.data) {
        const msg = result.error?.message || "Failed to join Lynk";
        if (isClosedRoomError(msg)) {
          setClosed("This Lynk has ended and can't be reopened.");
        } else {
          setErrorState(msg);
        }
        return;
      }

      const { token, peer, user: joinedUser, room } = result.data;
      setRoomSnapshot({
        id: room.id,
        createdBy: "",
        title: room.title,
        topic: room.topic,
        description: room.description,
        isLive: true,
        hasVideo: room.hasVideo,
        isPublic: true,
        status: "open",
        createdAt: new Date().toISOString(),
        host: {
          id: joinedUser.id,
          username: joinedUser.username,
          displayName: joinedUser.displayName,
          avatar: joinedUser.avatar,
          isVerified: joinedUser.isVerified,
        },
        speakers: [],
        listeners: 0,
        fishjamRoomId: room.fishjamRoomId,
      });
      isHostRef.current = peer.role === "host";

      setPhase("connecting");
      try {
        await joinRoomRef.current({
          peerToken: token,
          peerMetadata: {
            userId: joinedUser.id,
            username: joinedUser.username,
            avatar: joinedUser.avatar,
            role: peer.role,
          },
        });
      } catch (err: any) {
        if (cancelled) return;
        setErrorState(err?.message || "WebRTC connection failed");
        return;
      }
      if (cancelled) return;

      // Start media — mic always, camera only for video rooms.
      try {
        if (!micRef.current.isMicrophoneOn) await micRef.current.toggleMicrophone();
        setMicOn(true);
      } catch {
        // mic failure non-fatal
      }
      if (roomHasVideo) {
        try {
          if (!cameraRef.current.isCameraOn) await cameraRef.current.toggleCamera();
          setCameraOn(true);
        } catch {
          // camera failure non-fatal — audio-only
        }
      }
      if (cancelled) return;
      setPhase("connected");
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, initStarted, joinAnonymous, roomHasVideo]);

  // ── Sync Fishjam peerStatus → phase ───────────────────────────────────────
  useEffect(() => {
    if (phase === "closed" || phase === "error" || phase === "prejoin") return;
    if (peerStatus === "connected") setPhase("connected");
    else if (peerStatus === "error") setErrorState("Peer connection failed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStatus]);

  // ── Cleanup on unmount (mirrors native leave/reset) ───────────────────────
  useEffect(() => {
    return () => {
      try {
        leaveRoomRef.current();
      } catch {
        // ignore
      }
      try {
        cameraRef.current.stopCamera();
        micRef.current.stopMicrophone();
      } catch {
        // ignore
      }
      resetRoomStore();
      useRoomUIStore.getState().reset();
    };
  }, [resetRoomStore]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    void (async () => {
      await micRef.current.toggleMicrophone();
      setMicOn(micRef.current.isMicrophoneOn);
    })();
  }, [setMicOn]);

  const toggleCamera = useCallback(() => {
    void (async () => {
      await cameraRef.current.toggleCamera();
      setCameraOn(cameraRef.current.isCameraOn);
    })();
  }, [setCameraOn]);

  const handToggleInFlight = useRef(false);
  const toggleHand = useCallback(() => {
    if (handToggleInFlight.current) return;
    const nextRaised = !isHandRaised;
    setIsHandRaised(nextRaised);
    const isServerBackedRoom =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isServerBackedRoom) return;
    handToggleInFlight.current = true;
    void (async () => {
      try {
        const res = await sneakyLynkApi.toggleHand(id, nextRaised);
        if (!res.ok) {
          setIsHandRaised(!nextRaised);
          showToast("error", "Hand Update Failed", res.error?.message || "Try again.");
        }
      } catch {
        setIsHandRaised(!nextRaised);
        showToast("error", "Hand Update Failed", "We couldn't update your hand right now.");
      } finally {
        handToggleInFlight.current = false;
      }
    })();
  }, [id, isHandRaised, setIsHandRaised, showToast]);

  const leave = useCallback(() => {
    const isHost = isHostRef.current;
    void (async () => {
      try {
        if (isHost) {
          const result = await sneakyLynkApi.endRoom(id);
          if (!result.ok && !isClosedRoomError(result.error?.message)) {
            showToast(
              "error",
              "Couldn't close Lynk",
              result.error?.message || "Try again. The Lynk is still open.",
            );
            return;
          }
        } else {
          void sneakyLynkApi.leaveRoom(id);
        }
      } catch {
        // ignore — leaving is idempotent
      } finally {
        try {
          leaveRoomRef.current();
        } catch {
          // ignore
        }
        resetRoomStore();
        endRoomHistory(id);
        router.back();
      }
    })();
  }, [id, endRoomHistory, resetRoomStore, router, showToast]);

  // ── Free-host timer gate: subscription lookup + start time ────────────────
  // Mirrors the native room — a host on the free plan gets a 5-min countdown
  // and a duration-limit paywall; paid hosts have no timer. Only matters once
  // we're connected and know we're the host.
  useEffect(() => {
    if (phase !== "connected" || !isHostRef.current) return;
    if (timerStartedAt == null) setTimerStartedAt(Date.now());
    if (isPaidHost != null || !authUser?.id) return;
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("sneaky_subscriptions")
        .select("status, plan_id")
        .eq("host_id", authUser.id)
        .single();
      if (active) {
        setIsPaidHost(data?.status === "active" && data?.plan_id !== "free");
      }
    })();
    return () => {
      active = false;
    };
  }, [phase, authUser?.id, isPaidHost, timerStartedAt, setIsPaidHost, setTimerStartedAt]);

  // ── Host moderation (same edge fns as the native ParticipantActions) ───────
  const promote = useCallback(
    (userId: string) => {
      promoteListener(userId);
      void (async () => {
        const res = await videoApi.changeRole({
          roomId: id,
          targetUserId: userId,
          newRole: "co-host",
        });
        if (!res.ok) {
          showToast("error", "Couldn't promote", res.error?.message || "Try again.");
        }
      })();
    },
    [id, promoteListener, showToast],
  );

  const kick = useCallback(
    (userId: string) => {
      void (async () => {
        const res = await videoApi.kickUser({ roomId: id, targetUserId: userId });
        if (!res.ok) {
          showToast("error", "Couldn't remove", res.error?.message || "Try again.");
        }
      })();
    },
    [id, showToast],
  );

  const muteOne = useCallback(
    (userId: string) => {
      void (async () => {
        const res = await videoApi.mutePeer({ roomId: id, targetUserId: userId });
        if (!res.ok) {
          showToast("error", "Couldn't mute", res.error?.message || "Try again.");
        }
      })();
    },
    [id, showToast],
  );

  const muteAll = useCallback(() => {
    void (async () => {
      const res = await videoApi.muteAll(id);
      if (res.ok) showToast("success", "Muted everyone", "All participants are muted.");
      else showToast("error", "Couldn't mute all", res.error?.message || "Try again.");
    })();
  }, [id, showToast]);

  const onUpgrade = useCallback(() => {
    setShowTimeUp(false);
    router.push("/feed/sneaky-lynk/billing");
  }, [router, setShowTimeUp]);

  // ── Build tiles from local + remote peers ─────────────────────────────────
  const localStream = camera.cameraStream ?? null;
  const localName = joinAnonymous
    ? "You"
    : authUser?.username || authUser?.name || "You";

  const remotePeers = peers.remotePeers || [];
  const remoteTiles: Tile[] = remotePeers.map((peer) => {
    const meta = ((peer.metadata as any)?.peer ?? peer.metadata) as any;
    const cam = peer.cameraTrack as any;
    const mic = peer.microphoneTrack as any;
    return {
      key: peer.id,
      name: meta?.username ?? "Guest",
      avatar: meta?.avatar,
      isLocal: false,
      isHost: meta?.role === "host",
      videoStream: cam?.stream ?? null,
      isCameraOn: !!(cam?.stream || cam?.track || cam?.trackId),
      isMicOn: !!(mic?.stream || mic?.track || mic?.trackId),
    };
  });

  const localTile: Tile = {
    key: "local",
    name: localName,
    avatar: joinAnonymous ? undefined : authUser?.avatar || undefined,
    isLocal: true,
    isHost: isHostRef.current,
    videoStream: localStream,
    isCameraOn,
    isMicOn,
  };

  const stageTiles = [localTile, ...remoteTiles];
  const roomTitle = roomSnapshot?.title || paramTitle || getLynkDisplayName();
  const participantCount = stageTiles.length;

  // Listener grid (TanStack Virtual). For an audio room the remote peers list
  // can grow large; virtualize it. Rendered as a horizontal row of avatars.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: remoteTiles.length,
    horizontal: true,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
  });

  // ── Phase gates ────────────────────────────────────────────────────────────
  if (phase === "closed") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.back()}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/8">
            <Radio size={36} className="text-white/40" />
          </span>
          <h2 className="text-2xl font-bold mb-3">Lynk Closed</h2>
          <p className="text-white/60 mb-8">{closedReason}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full bg-white/8 px-6 py-4 font-semibold active:scale-95"
          >
            Back
          </button>
        </div>
      </RoomShell>
    );
  }

  if (phase === "error") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.back()}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h2 className="text-xl font-bold mb-3 text-rose-400">Couldn&apos;t join</h2>
          <p className="text-white/60 mb-8">{errorMessage}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full bg-white/8 px-6 py-4 font-semibold active:scale-95"
          >
            Back
          </button>
        </div>
      </RoomShell>
    );
  }

  const connecting = phase === "joining" || phase === "connecting";
  const isHost = isHostRef.current;
  const raisedHandCount = raisedHandOrder.length;
  const showTimer = isHost && isPaidHost === false && timerStartedAt != null;

  return (
    <main className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#06070d] text-white">
      <ConnectionBanner status={connecting ? "connecting" : peerStatus} />

      {/* Header */}
      <header
        className="relative z-10 flex items-center justify-between gap-2 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={leave}
          aria-label="Back"
          className="w-9 h-9 shrink-0 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <div className="flex min-w-0 flex-col items-center">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: connecting ? "#facc15" : ACCENT }}
            />
            <span className="text-[15px] font-semibold truncate max-w-[40vw]">{roomTitle}</span>
            {isHost ? (
              <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-blue-200">
                HOST
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1 text-xs text-white/50">
            <Users size={12} /> {participantCount}
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {showTimer ? (
            <WebRoomTimer
              startedAt={timerStartedAt}
              onTimeUp={() => setShowTimeUp(true)}
            />
          ) : null}
          {isHost && raisedHandCount > 0 ? (
            <button
              type="button"
              onClick={openHandQueue}
              aria-label={`${raisedHandCount} raised hands`}
              className="flex items-center gap-1 rounded-xl border border-pink-400/40 bg-pink-400/20 px-2.5 py-1.5 text-xs font-extrabold text-pink-100"
            >
              <Hand size={13} /> {raisedHandCount}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setParticipantsOpen(true)}
            aria-label="Participants"
            className="flex items-center gap-1 rounded-xl bg-white/8 px-2.5 py-1.5 text-xs font-bold text-white/90 hover:bg-white/15"
          >
            <Users size={14} /> {participantCount}
          </button>
          {isHost ? (
            <button
              type="button"
              onClick={muteAll}
              aria-label="Mute everyone"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-rose-300 hover:bg-white/15"
            >
              <VolumeX size={16} />
            </button>
          ) : null}
        </span>
      </header>

      {connecting ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
          <p className="text-white/60">Connecting…</p>
        </div>
      ) : (
        <>
          {/* Speaker / video stage */}
          <section className="flex-1 overflow-y-auto px-4 py-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {stageTiles.map((tile) => (
                <div
                  key={tile.key}
                  className="relative aspect-square overflow-hidden rounded-2xl bg-white/[0.04] border border-white/8"
                >
                  {tile.isCameraOn && tile.videoStream ? (
                    <VideoTile
                      stream={tile.videoStream}
                      muted={tile.isLocal}
                      mirror={tile.isLocal}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <SquareAvatar uri={tile.avatar} name={tile.name} size={72} />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                    <span className="truncate text-xs font-medium">
                      {tile.name}
                      {tile.isHost ? " · host" : ""}
                    </span>
                    {tile.isMicOn ? (
                      <Mic size={12} className="text-white/80 shrink-0" />
                    ) : (
                      <MicOff size={12} className="text-white/50 shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Listener row — TanStack Virtual (horizontal) */}
          {remoteTiles.length > 0 ? (
            <div className="px-4 pb-1">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
                In the room
              </p>
              <div ref={listScrollRef} className="overflow-x-auto" style={{ height: 96 }}>
                <div
                  style={{ width: rowVirtualizer.getTotalSize(), height: "100%", position: "relative" }}
                >
                  {rowVirtualizer.getVirtualItems().map((vItem) => {
                    const t = remoteTiles[vItem.index];
                    return (
                      <div
                        key={t.key}
                        className="absolute top-0 flex flex-col items-center gap-1"
                        style={{ left: vItem.start, width: vItem.size, height: "100%" }}
                      >
                        <SquareAvatar uri={t.avatar} name={t.name} size={56} />
                        <span className="max-w-[80px] truncate text-[10px] text-white/60">
                          {t.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* Floating reactions overlay */}
      <FloatingReactions reactions={reactions} />

      {/* Controls bar */}
      <footer className="relative z-10 flex flex-col items-center gap-3 pb-8 pt-2">
        <ReactionBar onSend={sendReaction} />
        <div className="flex items-center justify-center gap-4">
          <ControlButton
            onClick={toggleMic}
            active={isMicOn}
            label={isMicOn ? "Mute" : "Unmute"}
          >
            {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
          </ControlButton>

          {roomHasVideo ? (
            <ControlButton
              onClick={toggleCamera}
              active={isCameraOn}
              label={isCameraOn ? "Camera off" : "Camera on"}
            >
              {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
            </ControlButton>
          ) : null}

          <ControlButton onClick={toggleHand} active={isHandRaised} label="Raise hand">
            <Hand size={24} color={isHandRaised ? ACCENT : "#fff"} />
          </ControlButton>

          <ControlButton
            onClick={isChatOpen ? closeChat : openChat}
            active={isChatOpen}
            label="Chat"
          >
            <MessageCircle size={24} />
          </ControlButton>

          <ControlButton onClick={leave} danger label="Leave Lynk">
            <PhoneOff size={24} />
          </ControlButton>
        </div>
      </footer>

      {/* Chat (side-panel) */}
      <ChatPanel
        open={isChatOpen}
        onClose={closeChat}
        comments={comments}
        onSend={sendChat}
        currentUserId={authUser?.id}
      />

      {/* Hand-queue moderation (host) */}
      <HandQueuePanel
        open={isHandQueueOpen}
        onClose={closeHandQueue}
        order={raisedHandOrder}
        members={members}
        onPromote={(uid) => {
          promote(uid);
          closeHandQueue();
        }}
      />

      {/* Participants list + moderation */}
      <ParticipantsPanel
        open={isParticipantsOpen}
        onClose={() => setParticipantsOpen(false)}
        members={members}
        isHost={isHost}
        localUserId={authUser?.id}
        onPromote={promote}
        onKick={kick}
        onMute={muteOne}
      />

      {/* Free-host duration-limit paywall */}
      <TimeUpDialog open={showTimeUp} onUpgrade={onUpgrade} onLeave={leave} />

      {/* Eject banner (kicked / banned / room ended) */}
      {ejectReason ? (
        <EjectBanner
          reason={ejectReason}
          onDismiss={() => {
            setEjectReason(null);
            resetRoomStore();
            endRoomHistory(id);
            router.back();
          }}
        />
      ) : null}
    </main>
  );
}

// ── Header-only shell for closed/error states ─────────────────────────────────
function RoomShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#06070d] text-white">
      <div
        className="flex items-center px-4 py-3 border-b border-white/8"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <span className="flex-1 mx-4 truncate text-center text-[15px] font-semibold">{title}</span>
        <span className="w-9" />
      </div>
      {children}
    </div>
  );
}

// ── Pre-join screen (server rooms, non-creators) ──────────────────────────────
function PreJoinScreen({
  roomTitle,
  onJoin,
  onBack,
}: {
  roomTitle: string;
  onJoin: (anonymous: boolean) => void;
  onBack: () => void;
}) {
  const joinAnonymous = useRoomUIStore((s) => s.joinAnonymous);
  const setJoinAnonymous = useRoomUIStore((s) => s.setJoinAnonymous);
  return (
    <RoomShell title={roomTitle || "Join Lynk"} onBack={onBack}>
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#FC253A]/20">
          <Radio size={40} color={ROSE} />
        </span>
        <h2 className="mb-2 text-2xl font-bold text-center">{roomTitle || getLynkDisplayName()}</h2>
        <p className="mb-10 text-center text-white/60">Choose how you want to appear in this room</p>

        <div className="w-full max-w-md rounded-2xl bg-white/[0.06] px-5 py-4 mb-4">
          <p className="font-semibold mb-2">Room Safety</p>
          <p className="text-xs text-white/60 leading-5">
            By joining, you agree to DVNT community guidelines. Recording is prohibited,
            screenshots may notify the room, and participants can report unsafe behavior.
          </p>
        </div>

        <div className="w-full max-w-md rounded-2xl bg-white/[0.06] px-5 py-4 mb-8">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3 flex-1">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FC253A]/20 shrink-0">
                <EyeOff size={20} color={ROSE} />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">Join Anonymously</span>
                <span className="block text-xs text-white/60 mt-0.5">
                  You&apos;ll appear as &quot;Anon&quot; with no profile info
                </span>
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={joinAnonymous}
              onClick={() => setJoinAnonymous(!joinAnonymous)}
              className="relative w-12 h-7 rounded-full transition-colors shrink-0"
              style={{ backgroundColor: joinAnonymous ? ROSE : "#374151" }}
            >
              <span
                className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform"
                style={{ transform: joinAnonymous ? "translateX(20px)" : "translateX(2px)" }}
              />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onJoin(joinAnonymous)}
          className="w-full max-w-md rounded-full py-4 text-center font-bold text-white active:scale-[0.99]"
          style={{ backgroundColor: ROSE }}
        >
          {joinAnonymous ? "Join Anonymously" : "Join Lynk"}
        </button>
      </div>
    </RoomShell>
  );
}

// ── Public entry: pre-join gate + FishjamProvider wrapper ─────────────────────
export function SneakyLynkRoomScreen() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const id = String((params as any)?.id ?? "");
  const paramTitle = search?.get("title") ?? undefined;
  const hasVideoParam = search?.get("hasVideo");
  const isHostParam = search?.get("isHost");

  // Default true unless explicitly "0" (deep-link recipients omit it).
  const roomHasVideo = hasVideoParam !== "0";
  const isServerRoom = !id.startsWith("space-") && id !== "my-room";
  const isCreator = isHostParam === "1";
  const shouldGateJoin = isServerRoom && !isCreator;

  const phase = useRoomUIStore((s) => s.phase);
  const roomSnapshot = useRoomUIStore((s) => s.roomSnapshot);
  const setPhase = useRoomUIStore((s) => s.setPhase);
  const setRoomSnapshot = useRoomUIStore((s) => s.setRoomSnapshot);
  const setClosed = useRoomUIStore((s) => s.setClosed);
  const setJoinAnonymous = useRoomUIStore((s) => s.setJoinAnonymous);

  // Pre-join lookup for gated (server, non-creator) rooms.
  useEffect(() => {
    // Reset stale state from a previous room when (re)entering.
    useRoomUIStore.getState().reset();
    if (!shouldGateJoin || !id) {
      setPhase("connecting"); // creators / local rooms skip pre-join
      return;
    }
    setPhase("looking-up");
    let cancelled = false;
    (async () => {
      const room = await sneakyLynkApi.getRoomById(id);
      if (cancelled) return;
      if (!room) {
        setClosed("This Lynk is unavailable.");
      } else if (room.status === "ended" || !room.isLive) {
        setRoomSnapshot(room);
        setClosed("This Lynk has ended and can't be reopened.");
      } else {
        setRoomSnapshot(room);
        setPhase("prejoin");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shouldGateJoin]);

  const handleJoin = useCallback(
    (anonymous: boolean) => {
      setJoinAnonymous(anonymous);
      setPhase("joining");
    },
    [setJoinAnonymous, setPhase],
  );

  const roomTitle = roomSnapshot?.title || paramTitle || getLynkDisplayName();

  if (phase === "looking-up") {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-[#06070d] text-white">
        <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
        <p className="text-white/60">Loading Lynk…</p>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.back()}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/8">
            <Radio size={36} className="text-white/40" />
          </span>
          <h2 className="text-2xl font-bold mb-3">Lynk Closed</h2>
          <p className="text-white/60 mb-8">{useRoomUIStore.getState().closedReason}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full bg-white/8 px-6 py-4 font-semibold active:scale-95"
          >
            Back
          </button>
        </div>
      </RoomShell>
    );
  }

  // Gated server rooms wait for the user to tap "Join" before connecting.
  if (shouldGateJoin && phase === "prejoin") {
    return <PreJoinScreen roomTitle={roomTitle} onJoin={handleJoin} onBack={() => router.back()} />;
  }

  return (
    <FishjamProvider fishjamId={resolveFishjamAppId()}>
      <RoomInner
        id={id}
        paramTitle={paramTitle}
        roomHasVideo={roomHasVideo}
        isCreator={isCreator}
      />
    </FishjamProvider>
  );
}

export default SneakyLynkRoomScreen;
