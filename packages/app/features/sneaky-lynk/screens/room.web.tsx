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
 * Web capture protection is DETERRENCE + ATTRIBUTION only: browsers offer no
 * equivalent of Android FLAG_SECURE or the iOS capture blackout, and macOS
 * screenshots (⌘⇧3/4/5) and Win+Shift+S are invisible to the page. The live
 * room uses `SecureCaptureBoundary` for what web can actually do: an
 * anti-capture wrapper, focus/visibility blackout, context/copy/shortcut
 * blocking, and a forensic watermark that survives into any screenshot.
 *
 * Signals are TIERED (`useSecureCaptureGuard`): only PrintScreen keyup,
 * `beforeprint`, and Cmd/Ctrl+P notify the room. Blur and tab-switch blackout
 * locally and are never broadcast — a URL-bar click is not a recording, and
 * alleging one to the whole room (plus the host's DMs) was the bug this
 * replaced. Web never emits a recording event at all: it cannot detect one.
 *
 * The only ENFORCED tier is the app-only room: `video_join_room` refuses to
 * mint a peer token for a web client, so there is nothing here to protect.
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
  Camera as CameraIcon,
  CircleDot,
  PhoneOff,
  MessageCircle,
  Send,
  Crown,
  UserX,
  UserMinus,
  Volume2,
  VolumeX,
  Clock,
  X,
  Zap,
  Smartphone,
  ShieldAlert,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConnectionBanner, RoomTimer, connectionPhaseFromPeerStatus } from "@dvnt/ui";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { sneakyLynkApi } from "../api/supabase";
import { getSneakyUserLabel } from "../ui/user-labels";
import { buildHandQueue, HAND_QUEUE_COPY } from "../ui/hand-queue";
import {
  applyHostMuteEvent,
  canSelfUnmute,
  shouldStopMic,
  HOST_MUTE_COPY,
} from "@dvnt/app/lib/video/host-mute";
import { EjectModal } from "../ui/EjectModal";
import type { EjectKind } from "../ui/EjectModal.types";
import { classifySneakyLynkError } from "../errors";
import { videoApi } from "@dvnt/app/features/video/api";
import { useRoomReactions, GPU_REACTION_CAP } from "../hooks/useRoomReactions";
import { GpuReactionOverlay } from "@dvnt/app/features/gpu/reactions/GpuReactionOverlay";
import { useSneakyLynkCaptureBroadcast } from "../hooks/useSneakyLynkCaptureBroadcast";
import {
  fetchRoomComments,
  postRoomComment,
  subscribeToRoomComments,
  type RoomComment,
} from "../api/comments";
import type { SneakyUser } from "@dvnt/app/features/sneaky-lynk/types";
import { useRoomStore } from "../stores/room-store";
import { useLynkHistoryStore } from "../stores/lynk-history-store";
import { useSneakyLynkCaptureStore } from "@dvnt/app/lib/stores/sneaky-lynk-capture-store";
import { SecureCaptureBoundary } from "@dvnt/app/lib/secure-capture";
import { useRoomUIStore } from "../stores/room-ui-store";

const ACCENT = "#3FDCFF";
const ROSE = "#FC253A";
const PURPLE = "#8A40CF";
/** Deviant gradient stop 3 — likes/social, and the raised-hand marker. */
const MAGENTA = "#FF5BFC";

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
      disablePictureInPicture
      controlsList="nodownload noplaybackrate noremoteplayback"
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
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
  isCoHost: boolean;
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

/** Host-moderation watcher — `videoApi.subscribeToRoomEvents`.
 *
 *  Reports which of kick / ban / room-ended happened so EjectModal can render
 *  the difference, and applies host mute. Web previously subscribed for ejects
 *  only, so `mute_peer` and `mute_all` fell on the floor: a host muting a web
 *  participant got a "Participant has been muted" toast while that
 *  participant's microphone kept publishing. */
function useRoomModerationWatcher(
  roomId: string,
  userId: string | undefined,
  isHost: boolean,
  hostMuteLocked: boolean,
  // Structured, not pre-flattened: kick, ban and room-ended are three
  // different facts and the modal renders each differently.
  onEject: (kind: EjectKind, reason?: string) => void,
  /** Host moderation of the local microphone. `locked` is the host holding the
   *  mute; `stopMic` is whether this event also stops publishing. */
  onHostMute: (locked: boolean, stopMic: boolean) => void,
) {
  const onEjectRef = useRef(onEject);
  onEjectRef.current = onEject;
  const onHostMuteRef = useRef(onHostMute);
  onHostMuteRef.current = onHostMute;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const hostMuteLockedRef = useRef(hostMuteLocked);
  hostMuteLockedRef.current = hostMuteLocked;
  useEffect(() => {
    if (!roomId || !userId) return;
    const unsubscribe = videoApi.subscribeToRoomEvents(
      roomId,
      userId,
      (event) => {
        if (event.type === "room_ended") {
          onEjectRef.current("room_ended");
          return;
        }
        // Host moderation. Web listened for none of these, so a host muting a
        // web participant was silently a no-op — the host was told it worked
        // and the microphone kept running. The lock rule is shared with native
        // (lib/video/host-mute): mute stops publishing AND blocks self-unmute;
        // unmute lifts the block without opening the microphone.
        if (
          event.type === "mute_peer" ||
          event.type === "mute_all" ||
          event.type === "unmute_peer" ||
          event.type === "unmute_all"
        ) {
          const ctx = { isHost: isHostRef.current, targetsSelf: event.targetId === userId };
          const next = applyHostMuteEvent(
            { locked: hostMuteLockedRef.current },
            event.type,
            ctx,
          );
          onHostMuteRef.current(next.locked, shouldStopMic(event.type, ctx));
          return;
        }
        if (event.targetId && event.targetId === userId) {
          const payload = event.payload as { action?: string; reason?: string } | undefined;
          onEjectRef.current(payload?.action === "ban" ? "ban" : "kick", payload?.reason);
        }
      },
    );
    return unsubscribe;
  }, [roomId, userId]);
}

function CaptureNotificationBannerWeb() {
  const current = useSneakyLynkCaptureStore((s) => s.currentCapture);
  if (!current) return null;

  const isRecording = current.kind === "recording_start";
  const isSelf = current.isSelf;
  const iconClass = isSelf ? "text-[#3FDCFF]" : "text-[#FC253A]";
  const shellClass = isSelf
    ? "border-[#3FDCFF]/35 bg-[#08131a]/95"
    : "border-[#FC253A]/40 bg-[#16070b]/95";
  // Copy stays honest: nothing here is blocked. A screenshot that reaches this
  // banner already happened — what we do is attribute it. (Recording variants
  // only ever arrive from a remote NATIVE peer; web cannot detect recording
  // and never emits it — see `useSecureCaptureGuard`.)
  const title = isSelf
    ? isRecording
      ? "You're recording"
      : "You took a screenshot"
    : isRecording
      ? `${current.actorUsername} is recording`
      : `${current.actorUsername} took a screenshot`;
  const body = isSelf ? "Everyone in the room was notified." : "The room was notified.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-0 z-[70] flex justify-center px-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
    >
      <div className={`flex max-w-[92vw] items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${shellClass}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/8 ${iconClass}`}>
          {isRecording ? <CircleDot size={17} /> : <CameraIcon size={17} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-white">{title}</span>
          <span className="mt-0.5 block text-xs font-medium text-white/60">{body}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Persistent platform disclosure.
 *
 * Web capture protection is deterrence + attribution; native runs under
 * FLAG_SECURE / the iOS capture blackout. When the room is mixed, everyone —
 * including the web viewer themselves — is told, because a participant can't
 * make an informed choice about what to show without knowing which rail the
 * other people are on. Driven by presence on the `sneaky-capture-<roomId>`
 * channel (see `useSneakyLynkCaptureBroadcast`), so it tracks the room live
 * rather than only at join time.
 */
function WebViewerDisclosureChip() {
  const webPeerPresent = useSneakyLynkCaptureStore((s) => s.webPeerPresent);
  if (!webPeerPresent) return null;

  return (
    <span
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-300/35 bg-amber-300/12 px-2.5 py-1.5 text-[11px] font-semibold leading-tight text-amber-100"
    >
      <ShieldAlert size={13} className="shrink-0" />
      Web viewers in room — capture protection limited on web
    </span>
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
                  name={getSneakyUserLabel(c.author)}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold text-white/70">
                    {isOwn ? "You" : getSneakyUserLabel(c.author)}
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
  onInviteToSpeak,
  onLowerHand,
  onLowerAll,
}: {
  open: boolean;
  onClose: () => void;
  order: string[];
  members: WebMember[];
  onInviteToSpeak: (userId: string) => void;
  onLowerHand: (userId: string) => void;
  onLowerAll: () => void;
}) {
  // Queue semantics, labels and copy are shared with native — see ui/hand-queue.
  const queue = buildHandQueue(
    order,
    members.map((m) => ({
      userId: m.userId,
      username: m.username,
      displayName: m.displayName,
      avatar: m.avatar,
      isAnonymous: m.isAnonymous,
      anonLabel: m.anonLabel,
    })),
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`${HAND_QUEUE_COPY.title} · ${queue.length}`}
      icon={<Hand size={18} color={MAGENTA} />}
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            {HAND_QUEUE_COPY.empty}
          </p>
        ) : (
          queue.map((entry) => (
            <div
              key={entry.userId}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <span className="w-4 shrink-0 text-center font-mono text-xs font-bold text-white/40">
                {entry.position}
              </span>
              <SquareAvatar uri={entry.avatar} name={entry.label} size={36} />
              <span
                className={`flex-1 truncate text-sm font-medium ${
                  entry.departed ? "italic text-white/40" : "text-white"
                }`}
              >
                {entry.label}
              </span>
              {entry.departed ? null : (
                <>
                  <button
                    type="button"
                    onClick={() => onInviteToSpeak(entry.userId)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                  >
                    <Crown size={13} /> {HAND_QUEUE_COPY.invite}
                  </button>
                  <button
                    type="button"
                    onClick={() => onLowerHand(entry.userId)}
                    aria-label={`${HAND_QUEUE_COPY.lower} ${entry.label}`}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    {HAND_QUEUE_COPY.lower}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
      {queue.length > 0 ? (
        <footer className="border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onLowerAll}
            className="w-full rounded-lg bg-white/[0.08] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            {HAND_QUEUE_COPY.lowerAll}
          </button>
        </footer>
      ) : null}
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
  onDemote,
  onKick,
  onMute,
  onUnmute,
}: {
  open: boolean;
  onClose: () => void;
  members: WebMember[];
  isHost: boolean;
  localUserId: string | undefined;
  onPromote: (userId: string) => void;
  onDemote: (userId: string) => void;
  onKick: (userId: string) => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
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
          const name = getSneakyUserLabel(m);
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
                    onClick={() => onUnmute(m.userId)}
                    aria-label={`Let ${name} unmute`}
                    title="Lift the mute — they choose when to speak"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
                  >
                    <Mic size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMute(m.userId)}
                    aria-label={`Mute ${name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
                  >
                    <MicOff size={14} />
                  </button>
                  {m.role === "co-host" ? (
                    <button
                      type="button"
                      onClick={() => onDemote(m.userId)}
                      aria-label="Demote to listener"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    >
                      <UserMinus size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPromote(m.userId)}
                      aria-label="Promote to co-host"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                    >
                      <Crown size={14} />
                    </button>
                  )}
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
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/90 px-3 pb-[calc(env(safe-area-inset-bottom)+80px)] sm:items-center sm:px-0 sm:pb-0">
      <div className="w-full max-w-md rounded-3xl bg-[#0b0d14] px-6 pb-8 pt-7">
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

// ── Stage tile (one participant). `large` = featured host/co-host (wide,
//    top-of-stage); otherwise a compact square in the grid below. ─────────────
function StageTile({ tile, large }: { tile: Tile; large?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-white/8 bg-white/[0.04] ${
        large ? "aspect-video" : "aspect-square"
      }`}
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
          <SquareAvatar uri={tile.avatar} name={tile.name} size={large ? 104 : 72} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium">
          {tile.name}
          {tile.isHost ? " · host" : tile.isCoHost ? " · co-host" : ""}
        </span>
        {tile.isMicOn ? (
          <Mic size={12} className="text-white/80 shrink-0" />
        ) : (
          <MicOff size={12} className="text-white/50 shrink-0" />
        )}
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
  /** Set once the room has ever been joined. A ref, not state: it only ever
   *  reads during render alongside peerStatus, which already re-renders. */
  const everConnectedRef = useRef(false);
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
  // Lowering a hand is local moderation state, exactly as on native
  // (handleLowerHand / handleLowerAll) — no server round-trip.
  const setRaisedHand = useRoomStore((s) => s.setRaisedHand);
  const clearRaisedHands = useRoomStore((s) => s.clearRaisedHands);
  const promoteListener = useRoomStore((s) => s.promoteListener);
  const removeCoHost = useRoomStore((s) => s.removeCoHost);

  // Web UI/connection phase store (no useState).
  const phase = useRoomUIStore((s) => s.phase);
  const joinAnonymous = useRoomUIStore((s) => s.joinAnonymous);
  const closedReason = useRoomUIStore((s) => s.closedReason);
  const errorMessage = useRoomUIStore((s) => s.errorMessage);
  const isMicOn = useRoomUIStore((s) => s.isMicOn);
  const isCameraOn = useRoomUIStore((s) => s.isCameraOn);
  const roomSnapshot = useRoomUIStore((s) => s.roomSnapshot);
  const setInitStarted = useRoomUIStore((s) => s.setInitStarted);
  const setPhase = useRoomUIStore((s) => s.setPhase);
  const setRoomSnapshot = useRoomUIStore((s) => s.setRoomSnapshot);
  const setClosed = useRoomUIStore((s) => s.setClosed);
  const setAppOnlyPhase = useRoomUIStore((s) => s.setAppOnly);
  const setErrorState = useRoomUIStore((s) => s.setError);
  const setMicOn = useRoomUIStore((s) => s.setMicOn);
  const hostMuteLocked = useRoomUIStore((s) => s.hostMuteLocked);
  const setHostMuteLocked = useRoomUIStore((s) => s.setHostMuteLocked);
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
  const eject = useRoomUIStore((s) => s.eject);
  const setEject = useRoomUIStore((s) => s.setEject);

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
  const isCoHostRef = useRef(false);
  // Per-MOUNT join guard. Must be a local ref, NOT the global store's
  // `initStarted`: RoomInner is a child of SneakyLynkRoomScreen, and React runs
  // child effects before parent effects, so this effect would read a STALE
  // global `initStarted=true` left by a previous room entry (before the parent's
  // pre-join reset runs) and skip the join entirely — the room then mounts but
  // never calls video_join_room. A ref is fresh on every mount.
  const joinFiredRef = useRef(false);

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
  // GPU reactions raise the concurrent cap to 50; the DOM path stays at 6
  // because each reaction there is a keyframed <span>. Only flips true once the
  // overlay has a device, an atlas and a pipeline — any failure keeps the DOM
  // path exactly as it was.
  const [gpuReactions, setGpuReactions] = useState(false);
  const { reactions, sendReaction } = useRoomReactions({
    roomId: id,
    currentUser,
    cap: gpuReactions ? GPU_REACTION_CAP : undefined,
  });
  const { comments, send: sendChat } = useRoomChat(id, currentUser);
  const members = useRoomMembersSync(id, authUser?.id);
  const captureBroadcast = useSneakyLynkCaptureBroadcast({
    roomId: id,
    roomTitle: roomSnapshot?.title || paramTitle || undefined,
    localUserId: currentUser.id,
    localUsername: currentUser.displayName || currentUser.username,
    hostUserId: roomSnapshot?.host?.id,
    attributable: !currentUser.isAnonymous,
    realUsername: authUser?.username ?? undefined,
  });

  // isHostRef, not the derived `isHost` below it: the ref is kept current from
  // the peer's server role (line ~1219) and is the value in scope this early.
  useRoomModerationWatcher(id, authUser?.id, isHostRef.current, hostMuteLocked, (kind, reason) => {
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
    setEject({ kind, reason });
  },
  (locked, stopMic) => {
    // Lifting the lock restores control; it never starts publishing.
    setHostMuteLocked(locked);
    if (stopMic) {
      try {
        micRef.current.stopMicrophone();
      } catch {
        // ignore
      }
      setMicOn(false);
      showToast("info", "Muted", HOST_MUTE_COPY.mutedByHost);
    } else if (!locked) {
      showToast("info", "Unmuted", HOST_MUTE_COPY.released);
    }
  });

  // ── JOIN: sneaky-lynk peer token → Fishjam joinRoom → start media ──────────
  useEffect(() => {
    if (joinFiredRef.current || !id) return;
    joinFiredRef.current = true;
    setInitStarted(true);
    let cancelled = false;

    (async () => {
      setPhase("joining");
      const result = await sneakyLynkApi.joinRoom(id, joinAnonymous);
      if (cancelled) return;

      if (!result.ok || !result.data) {
        const msg = result.error?.message || "Failed to join Lynk";
        const classified = classifySneakyLynkError(
          result.error?.code,
          msg,
          result.error?.detail,
        );
        // App-only room: the edge function refused a peer token because we're
        // a browser. Not a failure to retry — a routing fact with its own
        // surface, so it gets a dedicated phase rather than the error screen.
        if (classified.reason === "app_only") {
          setAppOnlyPhase();
        } else if (isClosedRoomError(msg)) {
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
      isCoHostRef.current = peer.role === "co-host";

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
  }, [id, joinAnonymous, roomHasVideo]);

  // ── Sync Fishjam peerStatus → phase ───────────────────────────────────────
  useEffect(() => {
    if (phase === "closed" || phase === "error" || phase === "prejoin") return;
    if (peerStatus === "connected") {
      // Session history: once a room has been joined, a later "connecting"
      // from Fishjam is a RE-connect. The transport cannot tell us this —
      // PeerStatus has no reconnecting member.
      everConnectedRef.current = true;
      setPhase("connected");
    }
    else if (peerStatus === "error") setErrorState("Peer connection failed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerStatus]);

  // ── Connection watchdog: never leave the user on an infinite spinner ───────
  // Purely additive — only fires if we're still joining/connecting after 25s.
  // Turns a silent "won't connect" into a visible, retryable error.
  useEffect(() => {
    if (phase !== "joining" && phase !== "connecting") return;
    const timer = setTimeout(() => {
      const p = useRoomUIStore.getState().phase;
      if (p === "joining" || p === "connecting") {
        setErrorState(
          "Couldn't connect to the Lynk. Check your connection (camera/mic permissions, VPN, or ad-blockers can block WebRTC) and try again.",
        );
      }
    }, 25000);
    return () => clearTimeout(timer);
  }, [phase, setErrorState]);

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
    // Muting yourself is always allowed. Turning the microphone back ON is not,
    // while the host is holding the mute — otherwise the lock is decoration.
    const turningOn = !micRef.current.isMicrophoneOn;
    if (
      turningOn &&
      !canSelfUnmute({ locked: hostMuteLocked }, isHostRef.current)
    ) {
      showToast("info", "Muted by host", HOST_MUTE_COPY.blocked);
      return;
    }
    void (async () => {
      await micRef.current.toggleMicrophone();
      setMicOn(micRef.current.isMicrophoneOn);
    })();
  }, [setMicOn, hostMuteLocked, showToast]);

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

  // ── Free-host timer gate: entitlements + start time ───────────────────────
  // Mirrors the native room — a host on the free plan gets a 5-min countdown
  // and a duration-limit paywall; paid hosts have no timer. Only matters once
  // we're connected and know we're the host.
  //
  // Sourced from the canonical resolver (useEntitlements), same as native. This
  // previously read sneaky_subscriptions directly, which sees only the legacy
  // standalone-Sneaky rows: it missed every membership_subscriptions row, so a
  // paid DVNT member hosting on web was treated as free and hit the duration
  // paywall that native correctly hid from them. I3 — one entitlement read path.
  const { entitlements, isLoading: entitlementsLoading } = useEntitlements();
  // Same boolean the legacy check derived (active && plan_id !== "free"):
  // every paid plan grants unlimited session duration. `null` while unresolved,
  // which is what the store's tri-state and `showTimer` below expect.
  const resolvedIsPaidHost = entitlementsLoading
    ? null
    : entitlements.sessionMinutes === null;

  useEffect(() => {
    if (phase !== "connected" || !isHostRef.current) return;
    if (timerStartedAt == null) setTimerStartedAt(Date.now());
    if (resolvedIsPaidHost == null || isPaidHost === resolvedIsPaidHost) return;
    setIsPaidHost(resolvedIsPaidHost);
  }, [phase, resolvedIsPaidHost, isPaidHost, timerStartedAt, setIsPaidHost, setTimerStartedAt]);

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

  // Demote a co-host back to listener — the inverse of promote.
  const demote = useCallback(
    (userId: string) => {
      removeCoHost();
      void (async () => {
        const res = await videoApi.changeRole({
          roomId: id,
          targetUserId: userId,
          newRole: "participant",
        });
        if (!res.ok) {
          showToast("error", "Couldn't demote", res.error?.message || "Try again.");
        }
      })();
    },
    [id, removeCoHost, showToast],
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

  /** Releases the host mute. Does NOT turn the participant's microphone on —
   *  it hands the control back and they decide (lib/video/host-mute). */
  const unmuteOne = useCallback(
    (userId: string) => {
      void (async () => {
        const res = await videoApi.unmutePeer({ roomId: id, targetUserId: userId });
        if (!res.ok) {
          showToast("error", "Couldn't unmute", res.error?.message || "Try again.");
        }
      })();
    },
    [id, showToast],
  );

  const unmuteAll = useCallback(() => {
    void (async () => {
      const res = await videoApi.unmuteAll(id);
      if (res.ok) {
        showToast("success", "Unmuted everyone", "Participants can unmute themselves again.");
      } else {
        showToast("error", "Couldn't unmute all", res.error?.message || "Try again.");
      }
    })();
  }, [id, showToast]);

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
      isCoHost: meta?.role === "co-host",
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
    isCoHost: isCoHostRef.current,
    videoStream: localStream,
    isCameraOn,
    isMicOn,
  };

  const stageTiles = [localTile, ...remoteTiles];
  // The host (and any co-hosts) own the top of the stage — large and prominent;
  // everyone else with a tile sits in the smaller grid beneath. Falls back to a
  // uniform grid if somehow no host/co-host tile is present.
  const featuredTiles = stageTiles.filter((t) => t.isHost || t.isCoHost);
  const otherTiles = stageTiles.filter((t) => !t.isHost && !t.isCoHost);
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
  // App-only: the edge function refused a peer token because this is a
  // browser. Terminal on the web rail by design — this is the one place
  // Sneaky Lynk protection is ENFORCED rather than deterred, so there is no
  // retry, no fallback view, and nothing to reveal.
  if (phase === "app-only") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.back()}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#3FDCFF]/12 text-[#3FDCFF]">
            <Smartphone size={36} />
          </span>
          <h2 className="mb-3 text-2xl font-bold">This Lynk is app-only</h2>
          <p className="mb-8 max-w-md text-white/60">
            The host made this room app-only, so it can&apos;t be opened in a
            browser. In the DVNT app the OS blacks out screenshots and screen
            recordings at the system level — browsers have no equivalent, which
            is the whole point of the setting.
          </p>

          <a
            href={`dvnt://sneaky-lynk/room/${id}`}
            className="w-full max-w-xs rounded-full px-6 py-4 text-center font-bold text-black active:scale-95"
            style={{ backgroundColor: ACCENT }}
          >
            Open in the DVNT app
          </a>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <img
              src="https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/984f791e-38da-4c97-bd3d-257a488a1f30/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.png?format=500w"
              alt="Download on the App Store"
              className="h-11 w-auto"
            />
            <img
              src="https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/f87f69fd-f310-43b4-a8e7-7ba38246bee0/GetItOnGooglePlay_Badge_Web_color_English.png?format=500w"
              alt="Get it on Google Play"
              className="h-11 w-auto"
            />
          </div>

          <button
            type="button"
            onClick={() => router.back()}
            className="mt-8 rounded-full bg-white/8 px-6 py-3 text-sm font-semibold active:scale-95"
          >
            Back
          </button>
        </div>
      </RoomShell>
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
    <SecureCaptureBoundary
      enabled={phase === "connected" || phase === "joining" || phase === "connecting"}
      roomId={id}
      sessionId={roomSnapshot?.fishjamRoomId}
      userId={authUser?.id}
      userHandle={joinAnonymous ? currentUser.anonLabel ?? "anon" : authUser?.username}
      mode="sneaky-lynk"
      blackoutOnBlur
      blackoutOnVisibilityHidden
      watermark
      logEvents
      onCaptureAttempt={(kind) => captureBroadcast.notifyLocalCapture(kind)}
    >
      <main className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#06070d] text-white">
      <ConnectionBanner
        phase={connectionPhaseFromPeerStatus(peerStatus, everConnectedRef.current)}
      />
      <CaptureNotificationBannerWeb />

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
            <RoomTimer
              startedAt={timerStartedAt}
              onTimeUp={() => {
                setShowTimeUp(true);
                // Free session is over — stop broadcasting so no camera/mic keeps
                // running behind the upgrade sheet.
                cameraRef.current.stopCamera();
                micRef.current.stopMicrophone();
                setCameraOn(false);
                setMicOn(false);
              }}
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
            <>
              <button
                type="button"
                onClick={muteAll}
                aria-label="Mute everyone"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 hover:bg-white/15"
                style={{ color: ROSE }}
              >
                <VolumeX size={16} />
              </button>
              {/* Mute-all locks everyone out of their own microphone, so the
                  release has to be reachable from the same place. Without it a
                  host could mute the room and have no way to give it back. */}
              <button
                type="button"
                onClick={unmuteAll}
                aria-label="Let everyone unmute"
                title="Lift the mute — participants choose when to speak"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-white/80 hover:bg-white/15"
              >
                <Volume2 size={16} />
              </button>
            </>
          ) : null}
        </span>
      </header>

      {/* Standing disclosure — own row so the copy is never truncated by
          the three-column header. Renders only while a web viewer is in
          the room. */}
      <div className="relative z-10 px-4 pb-1 empty:hidden">
        <WebViewerDisclosureChip />
      </div>

      {connecting ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
          <p className="text-white/60">Connecting…</p>
        </div>
      ) : (
        <>
          {/* Speaker / video stage — host (+ co-hosts) own the top, large. */}
          <section className="flex-1 space-y-3 overflow-y-auto px-4 py-2">
            {featuredTiles.length > 0 ? (
              <div
                className={`mx-auto grid w-full max-w-2xl gap-3 ${
                  featuredTiles.length === 1 ? "grid-cols-1" : "grid-cols-2"
                }`}
              >
                {featuredTiles.map((tile) => (
                  <StageTile key={tile.key} tile={tile} large />
                ))}
              </div>
            ) : null}
            {otherTiles.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {otherTiles.map((tile) => (
                  <StageTile key={tile.key} tile={tile} />
                ))}
              </div>
            ) : null}
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
      <GpuReactionOverlay
        reactions={reactions}
        emojis={REACTION_EMOJIS}
        onAvailabilityChange={setGpuReactions}
      />
      <FloatingReactions reactions={gpuReactions ? [] : reactions} />

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
        onInviteToSpeak={(uid) => {
          promote(uid);
          closeHandQueue();
        }}
        onLowerHand={(uid) => setRaisedHand(uid, false)}
        onLowerAll={() => {
          clearRaisedHands();
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
        onDemote={demote}
        onKick={kick}
        onMute={muteOne}
        onUnmute={unmuteOne}
      />

      {/* Free-host duration-limit paywall */}
      <TimeUpDialog open={showTimeUp} onUpgrade={onUpgrade} onLeave={leave} />

      {/* Eject banner (kicked / banned / room ended) */}
      {eject ? (
        <EjectModal
          visible
          kind={eject.kind}
          reason={eject.reason}
          onDismiss={() => {
            setEject(null);
            resetRoomStore();
            endRoomHistory(id);
            router.back();
          }}
        />
      ) : null}
      </main>
    </SecureCaptureBoundary>
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
              style={{
                position: "relative",
                width: 48,
                height: 28,
                flexShrink: 0,
                padding: 0,
                border: "none",
                borderRadius: 9999,
                cursor: "pointer",
                backgroundColor: joinAnonymous ? ROSE : "#374151",
                transition: "background-color 140ms ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  width: 20,
                  height: 20,
                  borderRadius: 9999,
                  backgroundColor: "#fff",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
                  transition: "transform 140ms ease",
                  transform: joinAnonymous ? "translateX(20px)" : "translateX(0px)",
                }}
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
