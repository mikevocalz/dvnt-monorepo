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
  useVAD,
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
  Volume2,
  VolumeX,
  Smartphone,
  ShieldAlert,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConnectionBanner, RoomTimer } from "@dvnt/ui";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { sneakyLynkApi } from "../api/supabase";
import { getSneakyUserLabel } from "../ui/user-labels";
import { bannerPhaseFor, useRoomSession } from "../session/useRoomSession";
import { isActive } from "../session/machine";
import { useRoomHeartbeat } from "../hooks/useRoomHeartbeat";
import { useRoomReactions } from "../hooks/useRoomReactions";
import { buildHandQueue, HAND_QUEUE_COPY } from "../ui/hand-queue";
import {
  ChatPanel,
  HandQueuePanel,
  ParticipantsPanel,
  SidePanel,
  SquareAvatar,
  type WebMember,
} from "../ui/web/room-panels";
import {
  ControlButton,
  FloatingReactions,
  REACTION_EMOJIS,
  ReactionBar,
  StageTile,
  TimeUpDialog,
  VideoTile,
  type Tile,
} from "../ui/web/room-stage";
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


/** A room member as projected for the web moderation panels — the web-safe
 *  shape returned by `videoApi.subscribeToMembers` / `getRoomMembers`. */

function isClosedRoomError(message?: string | null) {
  if (!message) return false;
  return /no longer open|already ended|has ended|room not found|not found/i.test(message);
}

// ── <video> tile — binds a MediaStream imperatively (no useState) ─────────────

// Rounded-SQUARE avatar (never circular).



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
      className="flex items-center gap-2 rounded-lg border border-[#F5C518]/35 bg-[#F5C518]/12 px-2.5 py-1.5 text-[11px] font-semibold leading-tight text-[#F5C518]"
    >
      <ShieldAlert size={13} className="shrink-0" />
      Web viewers in room — capture protection limited on web
    </span>
  );
}

// ── Floating reactions overlay (emoji rise + fade) ────────────────────────────

// ── Reaction bar (emoji quick-row) ────────────────────────────────────────────

// ── Side-panel shell (web replacement for native bottom-sheets) ───────────────

// ── Chat panel (room comments) ────────────────────────────────────────────────

// ── Hand-queue panel (host moderation, FIFO order) ────────────────────────────

// ── Participants panel (host: mute / promote / remove) ────────────────────────

// ── Duration-limit paywall (web equivalent of SneakySubscriptionModal) ────────

// ── Stage tile (one participant). `large` = featured host/co-host (wide,
//    top-of-stage); otherwise a compact square in the grid below. ─────────────

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
  // Same session machine as native, fed from Fishjam's peerStatus. It owns
  // "is this room live" and the observability seam follows it. The banner
  // still reads peerStatus directly — see the native counterpart.
  const setServerEndsAt = useRoomUIStore((s) => s.setServerEndsAt);
  /**
   * Re-establish the room after a drop: fresh peer token, re-attach. Same
   * identity and role — the token is minted for this user against this room,
   * so the roster sees no leave/join pair.
   *
   * ponytail: the token+attach pair is written twice, here and in the initial
   * join effect, which additionally owns the error surfaces, the cancel guard
   * and the media start. Collapsing them means refactoring the working
   * first-join path; fold them together once a device has run a real reconnect.
   */
  const rejoinRoom = useCallback(async (): Promise<boolean> => {
    const result = await sneakyLynkApi.joinRoom(id, joinAnonymousRef.current);
    if (!result.ok || !result.data) return false;
    const { token, peer, user: joinedUser, room } = result.data;
    setServerEndsAt(room.endsAt ?? null);
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
      return true;
    } catch {
      return false;
    }
  }, [id, setServerEndsAt]);

  const session = useRoomSession(peerStatus, { onReconnect: rejoinRoom });
  // Keeps this member fresh so the browse list stops showing the room as Live
  // once everyone has gone. Tied to the session, not the mount: a room that is
  // still joining should not yet advertise a live host.
  useRoomHeartbeat(id, isActive(session));
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
  const joinAnonymousRef = useRef(joinAnonymous);
  joinAnonymousRef.current = joinAnonymous;
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
  const serverEndsAt = useRoomUIStore((s) => s.serverEndsAt);
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
  const { reactions, sendReaction } = useRoomReactions({
    roomId: id,
    currentUser,
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
      // The server's session deadline (video_rooms.ends_at). `undefined` means
      // a backend predating the gate, and the entitlement fallback below still
      // applies; `null` means unlimited; a value means count down to THIS.
      setServerEndsAt(room.endsAt ?? null);
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
  // Real voice activity, not a guess. Fishjam drives remote VAD from backend
  // vadNotification messages and polls the mic for the local peer
  // (@fishjam-cloud/react-client useVAD.d.ts). Without this the stage gives no
  // clue who is talking, which is the single thing a grid of faces must convey.
  const speakingByPeer = useVAD({
    peerIds: [
      ...(peers.localPeer?.id ? [peers.localPeer.id] : []),
      ...remotePeers.map((p) => p.id),
    ],
  });
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
      isSpeaking: !!speakingByPeer[peer.id],
    };
  });

  // useVAD is keyed by Fishjam peer id; the participants panel lists members by
  // our user id. Map once here rather than making the panel know about peers.
  const speakingByUserId: Record<string, boolean> = {};
  for (const peer of remotePeers) {
    const meta = ((peer.metadata as any)?.peer ?? peer.metadata) as any;
    const uid = meta?.userId;
    if (uid) speakingByUserId[uid] = !!speakingByPeer[peer.id];
  }
  if (authUser?.id && peers.localPeer?.id) {
    speakingByUserId[authUser.id] = !!speakingByPeer[peers.localPeer.id];
  }

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
    isSpeaking: !!(peers.localPeer?.id && speakingByPeer[peers.localPeer.id]),
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
            className="w-full max-w-xs rounded-lg px-6 py-4 text-center font-bold text-black active:scale-95"
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
            className="mt-8 rounded-lg bg-white/8 px-6 py-3 text-sm font-semibold active:scale-95"
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
            className="rounded-lg bg-white/8 px-6 py-4 font-semibold active:scale-95"
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
          <h2 className="text-xl font-bold mb-3 text-[#FC253A]">Couldn&apos;t join</h2>
          <p className="text-white/60 mb-8">{errorMessage}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg bg-white/8 px-6 py-4 font-semibold active:scale-95"
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
  // The server decides whether this session is limited; the client displays it.
  // Falls back to the entitlement read only when the backend returned no
  // endsAt field at all (pre-deploy), which is the only case the client still
  // has to guess.
  const serverLimited = serverEndsAt != null;
  const showTimer =
    isHost &&
    timerStartedAt != null &&
    (serverEndsAt !== undefined ? serverLimited : isPaidHost === false);
  const timerDurationMs =
    serverEndsAt != null && timerStartedAt != null
      ? new Date(serverEndsAt).getTime() - timerStartedAt
      : undefined;

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
      {/* The session machine is the single source now — it is what knows a
          first join from a reconnect, and what is driving the retries. */}
      <ConnectionBanner phase={bannerPhaseFor(session)} />
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
              durationMs={timerDurationMs}
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
              className="flex items-center gap-1 rounded-xl border border-[#FF5BFC]/40 bg-[#FF5BFC]/20 px-2.5 py-1.5 text-xs font-extrabold text-[#FF5BFC]"
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
          <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
          <p className="text-white/60">Connecting…</p>
        </div>
      ) : (
        <>
          {/* Speaker / video stage — host (+ co-hosts) own the top, large. */}
          {/* The stage grew one breakpoint wider at each size instead of
              staying capped at max-w-2xl (672px). On a tablet that cap left the
              room as a phone column floating in dead space, which is what made
              the aspect ratio read as wrong — the tiles were not mis-shaped, the
              stage was refusing the width. */}
          <section className="flex-1 space-y-3 overflow-y-auto px-4 py-2 md:px-6 lg:px-8">
            {featuredTiles.length > 0 ? (
              <div
                className={`mx-auto grid w-full gap-3 md:gap-4 ${
                  featuredTiles.length === 1
                    ? "max-w-2xl grid-cols-1 md:max-w-3xl lg:max-w-4xl"
                    : "max-w-2xl grid-cols-2 md:max-w-5xl lg:max-w-6xl"
                }`}
              >
                {featuredTiles.map((tile) => (
                  <StageTile key={tile.key} tile={tile} large />
                ))}
              </div>
            ) : null}
            {otherTiles.length > 0 ? (
              <div className="mx-auto grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3 md:max-w-5xl md:grid-cols-4 md:gap-4 lg:max-w-6xl lg:grid-cols-5">
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

      {/* One renderer. The GPU overlay used to suppress this one whenever it
          reported available, so a canvas that failed to initialise made
          reactions silently invisible. */}
      <FloatingReactions reactions={reactions} />

      {/* Controls bar */}
      <footer className="relative z-10 flex flex-col items-center gap-3 pb-8 pt-2">
        <ReactionBar onSend={sendReaction} />
        <div className="flex items-center justify-center gap-4">
          <ControlButton
            onClick={toggleMic}
            active={isMicOn}
            label={
              hostMuteLocked
                ? "Muted by host"
                : isMicOn
                  ? "Mute"
                  : "Unmute"
            }
          >
            {/* Held muted reads as a state to understand, not a failure, so
                it takes gold #F5C518 rather than signal. Same treatment as
                the native control. */}
            {isMicOn ? (
              <Mic size={24} />
            ) : (
              <MicOff size={24} color={hostMuteLocked ? "#F5C518" : undefined} />
            )}
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
        onMuteAll={muteAll}
        speakingByUserId={speakingByUserId}
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
          className="w-full max-w-md rounded-lg py-4 text-center font-bold text-white active:scale-[0.99]"
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
        <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
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
            className="rounded-lg bg-white/8 px-6 py-4 font-semibold active:scale-95"
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
