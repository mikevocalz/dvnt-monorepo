"use client";

/**
 * Sneaky Lynk Room — WEB (port of native
 * `app/(protected)/sneaky-lynk/room/[id].tsx`).
 *
 * TRANSPORT: MoQ (`useLynkBroadcast.web` → `@moq/*`), the same transport the
 * native room moved to in WS-3b and the genesis rooms already run. Fishjam is
 * gone from this screen: no `FishjamProvider`, no `useConnection` / `useCamera`
 * / `useMicrophone` / `usePeers` / `useVAD`.
 *
 * What that changes, and what it does not:
 *   - Media only. Join/leave, roles, ejection, host mute, chat, reactions,
 *     hand queue and billing are Supabase and are untouched.
 *   - Identity: a MoQ path (`lynk/<roomId>/<peerId>`) carries no metadata, so
 *     remote tiles are the Supabase roster joined to discovered publishers on
 *     the peer id — `peerIdForMember` in `features/video/lynk-participants.ts`,
 *     which is in LOCKSTEP with the `lynk-moq-token` edge function.
 *   - Remote video is a `<canvas>` (WebCodecs), not a MediaStream.
 *   - Voice activity: MoQ has no `useVAD` and `@moq/watch` exposes no analyser
 *     for a remote publisher, so each client measures its OWN microphone
 *     (`useSpeakingDetection`) and broadcasts the boolean on the room's
 *     Supabase channel (`useSpeakingPresence`) — the `useRoomReactions` pattern.
 *
 * Law 1 (data is sacred): the PORTABLE sneaky-lynk hooks/mutations are wired
 * verbatim —
 *   - Pre-join lookup: `sneakyLynkApi.getRoomById(id)`.
 *   - Join (peer token): `sneakyLynkApi.joinRoom(id, anonymous)` (Supabase edge
 *     fn `video_join_room`) → { token, peer, user, room } — the SAME token path
 *     native uses.
 *   - Hand raise: `sneakyLynkApi.toggleHand(id, raised)`.
 *   - Leave/end: `sneakyLynkApi.leaveRoom(id)` (non-host) /
 *     `sneakyLynkApi.endRoom(id)` (host) + `useLynkHistoryStore.endRoom(...)`.
 *   - Hand-raise / chat / eject domain state = the SHARED `useRoomStore`.
 *
 * Web capture protection is DETERRENCE only: browsers offer no
 * equivalent of Android FLAG_SECURE or the iOS capture blackout, and macOS
 * screenshots (⌘⇧3/4/5) and Win+Shift+S are invisible to the page. The live
 * room uses `SecureCaptureBoundary` for what web can actually do: an
 * anti-capture wrapper, focus/visibility blackout, and context/copy/shortcut
 * blocking. The live video is intentionally free of repeated watermark text.
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
  ArrowLeft,
  Radio,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  Camera as CameraIcon,
  CircleDot,
  PhoneOff,
  MessageCircle,
  Smartphone,
  ShieldAlert,
} from "lucide-react";
import { RoomHeader } from "../ui/web/room-header";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ConnectionBanner, Dialog, RoomTimer } from "@dvnt/ui";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.web";
import { DeviceSelectors } from "../ui/web/DeviceSelectors";
import { useRoomAudioOutput } from "../hooks/use-room-audio-output.web";
import { PreJoinSetup } from "../ui/web/PreJoinSetup";
import { CaptureErrorBanner } from "../ui/web/CaptureErrorBanner";
import { useSpeakingDetection } from "@dvnt/app/lib/lynk/useSpeakingDetection.web";
import { useSpeakingPresence } from "@dvnt/app/lib/lynk/useSpeakingPresence";
import { speakingSenderId } from "@dvnt/app/lib/lynk/speaking-presence";
import { peerIdForMember } from "@dvnt/app/features/video/lynk-participants";
import type { LynkState } from "@dvnt/app/lib/lynk/lynkState";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { sneakyLynkApi } from "../api/supabase";
import { getRoomEntryStatus } from "../room-entry-status";
import { eventWaitingCopy, roomUnavailableTitle } from "../ui/event-waiting-copy";
import { useEventLynkWaitingRoom } from "../hooks/useEventLynkWaitingRoom";
import { useFullRoomRetry } from "../hooks/useFullRoomRetry";
import { getSneakyUserLabel } from "../ui/user-labels";
import { participantModeration } from "../ui/moderation-permissions";
import {
  bannerPhaseFor,
  useRoomSession,
  type RoomTransportStatus,
} from "../session/useRoomSession";
import { isActive } from "../session/machine";
import { completePreJoin } from "../session/complete-prejoin";
import { getRoomEntryIdentity, type RoomEntryIdentity } from "../api/room-entry-identity";
import { roomShareCopy, shareRoomLink } from "../room-sharing";
import { lynkRoomAppUrl, lynkRoomShareUrl, normalizeLynkRoomId } from "../room-links";
import { authenticatedLynkAccount } from "../room-entry-auth";
import { leaveRoomSafely } from "../session/leave-room";
import { withRoomAdmissionLock } from "../session/room-admission-lock";
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
  ReactionsPicker,
  FloatingReactions,
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
import { classifySneakyLynkError, type ClassifiedError } from "../errors";
import { webJoinFeedback, webConnectionFeedback } from "../ui/web/room-status";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";
import { videoApi } from "@dvnt/app/features/video/api";
import { useSneakyLynkCaptureBroadcast } from "../hooks/useSneakyLynkCaptureBroadcast";
import { useRoomChat } from "../hooks/useRoomChat";
import { useRoomLifecycle } from "../../video/useRoomLifecycle";
import { useRoomMembers } from "../hooks/useRoomMembers";
import { useRoomEntryScope } from "../hooks/useRoomEntryScope";
import type { SneakyUser } from "@dvnt/app/features/sneaky-lynk/types";
import { useRoomStore } from "../stores/room-store";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { isPublisherRole } from "../publish-roles";
import { RoomViewport } from "../ui/web/RoomViewport";
import { RoomStage } from "../ui/web/RoomStage";
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

/**
 * MoQ lifecycle → the session machine's vocabulary. `requesting-token` is a
 * connect step, not an idle one: the room is already trying, and reporting idle
 * would leave the banner silent through the slowest part of a join.
 */
const TRANSPORT_STATUS_BY_LYNK_STATE: Record<LynkState, RoomTransportStatus> = {
  idle: "idle",
  "requesting-token": "connecting",
  connecting: "connecting",
  live: "connected",
  reconnecting: "reconnecting",
  ended: "disconnected",
  error: "error",
};

/**
 * Room events that actually remove someone from the room.
 *
 * Deliberately a whitelist. The alternative — "anything targeted at me that I
 * did not otherwise handle" — is what ejected a user at the moment the host
 * promoted them.
 */
const EJECT_EVENT_TYPES = new Set(["eject", "member_kicked", "member_banned"]);

/** Seconds a user gets to read "this Lynk ended" before we take them out. */
const ROOM_ENDED_GRACE_SECONDS = 10;

/** Where a finished room returns you: the Lynk list, in the messages inbox. */
const LYNKS_LIST_ROUTE = "/feed/messages";

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

/** Roster reads start after server admission and reconcile on every reconnect. */
function useRoomMembersSync(roomId: string, localUserId: string | undefined, enabled: boolean) {
  const { members: roster, error, ready } = useRoomMembers(roomId, localUserId, enabled);
  const members: WebMember[] = roster.map((m) => ({ ...m, handRaised: !!m.handRaised }));
  const setRaisedHands = useRoomStore((s) => s.setRaisedHands);
  useEffect(() => {
    if (error) useUIStore.getState().showToast("error", "Reconnecting participants", "The room roster couldn't refresh. We'll keep trying.");
  }, [error]);
  useEffect(() => {
    const hands: Record<string, boolean> = {};
    for (const m of members) if (m.handRaised && m.status === "active" && m.userId !== localUserId) hands[m.userId] = true;
    setRaisedHands(hands);
  }, [roster, localUserId, setRaisedHands]);
  return { members, error, ready };
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
        // ONLY these three are ejections. This used to be a catch-all — any
        // targeted event the branches above did not claim was treated as a
        // kick — so `role_changed` ejected the user it was promoting. Being
        // made a co-host tore your transport down and showed you a "removed
        // from the room" modal. The native leg never had this: it uses an
        // explicit switch (useVideoRoom.handleRoomEvent).
        //
        // `video_kick_user` emits `eject` + `member_kicked`; `video_ban_user`
        // emits `eject` + `member_banned`. Everything else targeted at us —
        // role_changed, member_joined, token_issued — is not an ejection.
        if (EJECT_EVENT_TYPES.has(event.type) && event.targetId === userId) {
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
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-[#F5C518]/35 bg-[#F5C518]/10 px-3 py-1.5 text-[11px] font-medium leading-tight text-[#F5C518]"
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

// ── Inner room (MoQ transport + the Supabase room domain) ────────────────────
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
  const accountKey = useAuthStore((state) => authenticatedLynkAccount(state) ?? "");
  const [admission, setAdmission] = useState<{ owner: string; user: SneakyUser } | null>(null);
  const admitted = admission?.owner === accountKey && !!accountKey;
  const endRoomHistory = useLynkHistoryStore((s) => s.endRoom);

  const setServerEndsAt = useRoomUIStore((s) => s.setServerEndsAt);

  // ── Media transport (MoQ) ─────────────────────────────────────────────────
  // The role only exists once `video_join_room` resolves, so `canPublish` is
  // false until then: no publish token is requested, `lynk-moq-token` is never
  // asked to deny one (it denies `publish` for a listener), and the camera/mic
  // stay closed. When the role lands the hook mints, connects and goes live.
  const joinCameraOn = useRoomUIStore((s) => s.joinCameraOn);
  const joinMicOn = useRoomUIStore((s) => s.joinMicOn);
  const localRole = useRoomUIStore((s) => s.localRole);
  // Mirrors PUBLISH_ROLES in `lynk-moq-token`. `participant` — the role every
  // joiner gets — belongs here: without it a guest never asked for a publish
  // token, so the host was hosting people who could see and hear but could
  // never be seen or heard. Camera/mic still start from the pre-join choice.
  const { members, ready: rosterReady, error: rosterError } = useRoomMembersSync(id, admission?.user.id, admitted);
  const canPublish = admitted && isPublisherRole(localRole);
  const cameraDeviceId = useRoomUIStore(s => s.cameraDeviceId);
  const microphoneDeviceId = useRoomUIStore(s => s.microphoneDeviceId);
  const isDeviceSettingsOpen = useRoomUIStore(s => s.isDeviceSettingsOpen);
  const setDeviceSettingsOpen = useRoomUIStore(s => s.setDeviceSettingsOpen);
  const audioOutput = useRoomAudioOutput();
  const audioOutputState = useRoomUIStore(state => state.audioOutputState);
  const lynk = useLynkBroadcast(admitted ? id : undefined, canPublish, { cameraDeviceId, microphoneDeviceId, audioOutput });

  // Same session machine as native, now fed from the MoQ lifecycle. It owns
  // "is this room live" and the observability seam follows it.
  //
  // No `onReconnect`: `Moq.Connection.Reload` owns transport recovery, so the
  // machine observes `reconnecting → live` rather than driving a rejoin. The
  // Fishjam version had to re-mint a peer token by hand because its transport
  // could not reconnect itself.
  const session = useRoomSession(
    TRANSPORT_STATUS_BY_LYNK_STATE[lynk.state] ?? "idle",
  );
  // Keeps this member fresh so the browse list stops showing the room as Live
  // once everyone has gone. Tied to the session, not the mount: a room that is
  // still joining should not yet advertise a live host.
  useRoomHeartbeat(id, isActive(session));

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

  // Web UI/connection phase store (no useState).
  const phase = useRoomUIStore((s) => s.phase);
  const joinAnonymous = useRoomUIStore((s) => s.joinAnonymous);
  const closedReason = useRoomUIStore((s) => s.closedReason);
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
  const ejectCountdown = useRoomUIStore((s) => s.ejectCountdown);
  const setEjectCountdown = useRoomUIStore((s) => s.setEjectCountdown);

  // Stable ref so callbacks/effects never capture a stale transport object —
  // the hook's callbacks are not identity-stable across a reconnect.
  const lynkRef = useRef(lynk);
  lynkRef.current = lynk;
  const setLocalRole = useRoomUIStore((s) => s.setLocalRole);
  const setLocalUserId = useRoomUIStore((s) => s.setLocalUserId);
  /**
   * Who WE are, per the server. `authUser.id` is a different value from
   * `video_room_members.user_id`, which made every self-comparison in this
   * screen silently false: the host saw a second tile of themselves in the
   * grid, and a promoted co-host never found their own row to learn the new
   * role. Falls back to the auth id only until the join response lands.
   */
  const localUserId = admitted ? admission?.user.id : undefined;
  const isHostRef = useRef(isCreator);
  // Host exit, bulk controls and queue visibility follow current server role,
  // not only the first admission response. An inactive actor has no authority.
  isHostRef.current = admitted && (rosterReady
    ? members.some(member => member.userId === localUserId && member.status === "active" && member.role === "host")
    : localRole === "host");
  // Per-MOUNT join guard. Must be a local ref, NOT the global store's
  // `initStarted`: RoomInner is a child of SneakyLynkRoomScreen, and React runs
  // child effects before parent effects, so this effect would read a STALE
  // global `initStarted=true` left by a previous room entry (before the parent's
  // pre-join reset runs) and skip the join entirely — the room then mounts but
  // never calls video_join_room. A ref is fresh on every mount.
  const joinFiredRef = useRef(false);
  // Bumped by the waiting room to re-run the join effect after a host starts.
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [joinFailure, setJoinFailure] = useState<ClassifiedError | null>(null);
  const joinCompletedRef = useRef(false);
  const currentAccountKeyRef = useRef(accountKey);
  currentAccountKeyRef.current = accountKey;
  const accountEpochRef = useRef(0);
  const fullRoomStopRef = useRef<() => void>(() => {});
  const roomMountedRef = useRef(true);
  const [pageActive, setPageActive] = useState(() =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    roomMountedRef.current = true;
    const update = () => {
      const visible = document.visibilityState !== "hidden";
      // Revoke synchronously: hidden→visible in one React batch must not
      // revive permission for an outstanding automatic admission.
      if (!visible) fullRoomStopRef.current();
      setPageActive(visible);
    };
    document.addEventListener("visibilitychange", update);
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (authenticatedLynkAccount(next) !== authenticatedLynkAccount(previous)) {
        accountEpochRef.current += 1;
        currentAccountKeyRef.current = authenticatedLynkAccount(next) ?? "";
        fullRoomStopRef.current();
      }
    });
    return () => {
      roomMountedRef.current = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  type RetryOutcome = "joined" | "full" | "stopped";
  const pendingFullRetryRef = useRef<{
    isCurrent: () => boolean;
    resolve: (outcome: RetryOutcome) => void;
  } | null>(null);
  const fullRoomRetry = useFullRoomRetry({
    roomKey: `${accountKey}:${id}`,
    eligible: joinFailure?.reason === "room_full" && !admitted && !eject,
    active: pageActive,
    onCancelAttempt: () => {
      if (roomMountedRef.current && !joinCompletedRef.current) setPhase("error");
    },
    onAttempt: ({ isCurrent }) => new Promise<RetryOutcome>((resolve) => {
      if (!isCurrent() || pendingFullRetryRef.current || useRoomUIStore.getState().phase !== "error") {
        resolve("stopped");
        return;
      }
      pendingFullRetryRef.current = { isCurrent, resolve };
      joinFiredRef.current = false;
      joinCompletedRef.current = false;
      setPhase("joining");
      setJoinAttempt(value => value + 1);
    }),
  });
  fullRoomStopRef.current = fullRoomRetry.stop;

  // Local identity projected as a SneakyUser for reactions/chat authorship.
  const currentUser: SneakyUser = admitted && admission ? admission.user : {
    id: "", username: "", displayName: "", avatar: "", isVerified: false,
  };

  // Shared realtime/data wiring (same channels + edge fns as the native room).
  // GPU reactions raise the concurrent cap to 50; the DOM path stays at 6
  // because each reaction there is a keyframed <span>. Only flips true once the
  // overlay has a device, an atlas and a pipeline — any failure keeps the DOM
  // path exactly as it was.
  const { reactions, sendReaction } = useRoomReactions({
    roomId: admitted ? id : "",
    currentUser,
  });
  const { comments, send: sendChat, error: chatError, loading: chatLoading } = useRoomChat({ roomId: id, currentUser, enabled: admitted });

  // ── Role changes reach us on the ROSTER, not in the join response ─────────
  // `localRole` is what gates `canPublish`, and it was only ever set once, from
  // `video_join_room`. So a listener the host promoted to co-host stayed a
  // listener on this client forever: no publish token, camera and mic still
  // shut, and the only way out was to leave and rejoin. Fishjam never showed
  // this because publishing there was not gated on the role at all.
  //
  // `videoApi.subscribeToMembers` already delivers the updated row, so the fix
  // is to treat the roster as the source of truth for our own role too.
  useEffect(() => {
    const me = members.find((m) => m.userId === localUserId);
    if (me?.role && me.role !== localRole) setLocalRole(me.role);
  }, [members, localUserId, localRole, setLocalRole]);
  const captureBroadcast = useSneakyLynkCaptureBroadcast({
    roomId: id,
    roomTitle: roomSnapshot?.title || paramTitle || undefined,
    localUserId: currentUser.id,
    localUsername: currentUser.displayName || currentUser.username,
    hostUserId: roomSnapshot?.host?.id,
    attributable: !currentUser.isAnonymous,
    realUsername: authUser?.username ?? undefined,
  });

  const { notifyEnded } = useRoomLifecycle({
    roomId: id, userId: localUserId, enabled: admitted,
    connectionStatus: TRANSPORT_STATUS_BY_LYNK_STATE[lynk.state],
    onEnded: () => {
      setAdmission(null);
      lynkRef.current.end();
      setMicOn(false);
      setCameraOn(false);
      setEject({ kind: "room_ended" });
    },
  });

  // isHostRef, not the derived `isHost` below it: the ref is kept current from
  // the peer's server role (line ~1219) and is the value in scope this early.
  useRoomModerationWatcher(id, localUserId, isHostRef.current, hostMuteLocked, (kind, reason) => {
    if (kind === "room_ended") { notifyEnded(); return; }
    setAdmission(null);
    try {
      lynkRef.current.end();
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
        lynkRef.current.setMicEnabled(false);
      } catch {
        // ignore
      }
      setMicOn(false);
      showToast("info", "Muted", HOST_MUTE_COPY.mutedByHost);
    } else if (!locked) {
      showToast("info", "Unmuted", HOST_MUTE_COPY.released);
    }
  });

  // ── JOIN: `video_join_room` → roster, role, deadline. NOT the media path.
  //    MoQ mints its own token from `lynk-moq-token` inside `useLynkBroadcast`,
  //    keyed off the role this call resolves. ────────────────────────────────
  useEffect(() => {
    if (joinFiredRef.current || !id || !accountKey) return;
    joinFiredRef.current = true;
    setInitStarted(true);
    let cancelled = false;
    const ownerEpoch = accountEpochRef.current;
    const isOwnerCurrent = () => roomMountedRef.current && accountEpochRef.current === ownerEpoch && currentAccountKeyRef.current === accountKey && authenticatedLynkAccount(useAuthStore.getState()) === accountKey;
    const fullAttempt = pendingFullRetryRef.current;
    pendingFullRetryRef.current = null;
    let fullAttemptSettled = false;
    const finishFullAttempt = (outcome: RetryOutcome) => {
      if (fullAttemptSettled) return;
      fullAttemptSettled = true;
      fullAttempt?.resolve(outcome);
    };
    const attemptCurrent = () => !cancelled && isOwnerCurrent() && (!fullAttempt || (fullAttempt.isCurrent() && document.visibilityState !== "hidden"));
    if (!fullAttempt) setJoinFailure(null);
    // Own the timeout with this request. A late admission result must not turn
    // capture on after the person has already been shown a failed attempt.
    const timeout = setTimeout(() => {
      if (cancelled || joinCompletedRef.current) return;
      cancelled = true;
      setJoinFailure(null);
      setErrorState("The join request timed out. Check your connection and try again.");
    }, 25000);

    withRoomAdmissionLock(accountKey, id, async () => {
      if (!attemptCurrent()) { finishFullAttempt("stopped"); return; }
      setPhase("joining");
      const result = await sneakyLynkApi.joinRoom(id, joinAnonymous, { isCurrent: attemptCurrent });
      clearTimeout(timeout);
      if (!attemptCurrent()) {
        // An opted-in attempt can finish after Stop or tab hiding. Never
        // apply that admission or start media. Keep its retry lock until the
        // abandoned seat is released, and never leave using a new account.
        if (fullAttempt && result.ok && isOwnerCurrent() && !joinCompletedRef.current) {
          await sneakyLynkApi.leaveRoom(id, { isCurrent: () => isOwnerCurrent() && !joinCompletedRef.current });
        }
        if (fullAttempt && isOwnerCurrent() && !joinCompletedRef.current) setPhase("error");
        finishFullAttempt("stopped");
        return;
      }

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
        } else if (classified.reason === "waiting_for_host") {
          // Event Lynk not started yet: the waiting room below heartbeats
          // and re-runs this join once the host starts.
          setPhase("waiting");
        } else if (isClosedRoomError(msg)) {
          setClosed("This Lynk has ended and can't be reopened.");
        } else {
          setJoinFailure(classified);
          setErrorState(classified.body);
        }
        finishFullAttempt(classified.reason === "room_full" ? "full" : "stopped");
        return;
      }

      const { peer, user: joinedUser, room } = result.data;
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
      setLocalUserId(joinedUser.id);
      setAdmission({ owner: accountKey, user: joinedUser });
      isHostRef.current = peer.role === "host";

      setPhase("connecting");
      // Publishing the role is what starts the transport: `canPublish` flips,
      // the publish token mints, and the go-live effect below fires. A listener
      // keeps `canPublish` false and only ever subscribes.
      setLocalRole(peer.role);
      joinCompletedRef.current = true;
      finishFullAttempt("joined");
    }).catch(() => {
      clearTimeout(timeout);
      if (attemptCurrent()) {
        setJoinFailure(null);
        setErrorState("Couldn't join this Lynk. Check your connection and try again.");
      } else if (fullAttempt && isOwnerCurrent() && !joinCompletedRef.current) {
        setPhase("error");
      }
      finishFullAttempt("stopped");
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      // A join that never resolved must not leave its guard standing.
      //
      // React StrictMode replays initial effects. Reset only the unfinished
      // entry guard. Media metadata is deliberately not a dependency: a camera
      // capability change must never replace an owned full-room admission.
      if (!joinCompletedRef.current) joinFiredRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accountKey, joinAnonymous, joinAttempt]);

  // Waiting room: heartbeat until the host starts, then run the join above
  // again so video_join_room still applies bans, capacity and verification.
  const eventWaiting = useEventLynkWaitingRoom({
    roomId: id,
    enabled: phase === "waiting",
    onAdmitted: () => {
      joinFiredRef.current = false;
      setJoinAttempt((n) => n + 1);
    },
    onRefused: (message) => setClosed(message),
  });

  // ── Go live ───────────────────────────────────────────────────────────────
  // Publishing starts once we hold BOTH a publish-capable role and a minted
  // token. `goLive` no-ops without a token and changes identity when one
  // arrives, so this re-runs exactly once more at that point. Same effect as
  // the native room — deliberately NOT called inside the join effect, where
  // `lynkRef` still holds the render whose token was null.
  useEffect(() => {
    if (!canPublish || lynk.isLive) return;
    void lynk.goLive();
  }, [canPublish, lynk.isLive, lynk.goLive]);

  /**
   * Arrive the way you said you would.
   *
   * The pre-join screen asks whether your camera and mic are on; the room
   * used to start both regardless, so the answer was decoration and you
   * walked in live having just said you did not want to. Applied ONCE, when
   * publishing becomes possible — after that the in-room controls own it.
   */
  // Capture the reviewed entry choices once; later role changes must not
  // replay them. UI resets belong to the parent entry scope, not this child
  // cleanup: StrictMode replays child effects while the same entry stays active.
  const joinPrefsRef = useRef({ camera: joinCameraOn, mic: joinMicOn });
  const joinPrefsAppliedRef = useRef(false);
  useEffect(() => {
    if (!canPublish || joinPrefsAppliedRef.current) return;
    joinPrefsAppliedRef.current = true;
    lynkRef.current.setCameraEnabled(joinPrefsRef.current.camera && roomHasVideo);
    lynkRef.current.setMicEnabled(joinPrefsRef.current.mic && !hostMuteLocked);
    // RoomInner is keyed by room/account. Within that lifetime, role changes
    // must preserve the user's latest intent, not replay the pre-join choices.
    // Device reconstruction retains the hook flags; it needs no preference reset.
  }, [canPublish, roomHasVideo, hostMuteLocked]);

  // ── Room phase ────────────────────────────────────────────────────────────
  // Being IN the room is a Supabase fact (`video_join_room` resolved a role),
  // not a media fact. Gating the whole screen on media meant a listener — who
  // never publishes, and whose room may have nobody on air yet — sat on a
  // full-screen spinner with a working roster and chat behind it. Transport
  // health is what `ConnectionBanner` (fed by the session machine) is for.
  useEffect(() => {
    if (phase === "closed" || phase === "prejoin" || (!admitted && phase === "error")) return;
    if (admitted && localRole) setPhase("connected");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lynk.state, lynk.error, localRole, admitted]);

  // The transport owns capture; mirror it into the UI store so the mic/camera
  // buttons can never drift from what is actually being published.
  useEffect(() => {
    setMicOn(lynk.microphoneActive && !lynk.microphoneError && canPublish);
  }, [lynk.microphoneActive, lynk.microphoneError, canPublish, setMicOn]);

  useEffect(() => {
    setCameraOn(lynk.cameraActive && !lynk.cameraError && canPublish && roomHasVideo);
  }, [lynk.cameraActive, lynk.cameraError, canPublish, roomHasVideo, setCameraOn]);

  // An audio-only room must never open the camera. Set before the role lands,
  // so the capture gate in `useLynkBroadcast` never sees `cameraEnabled` true.
  useEffect(() => {
    if (!roomHasVideo) lynkRef.current.setCameraEnabled(false);
  }, [roomHasVideo]);

  /**
   * The host ended the room: count down, then leave on the user's behalf.
   *
   * A room that has ended has nothing left to look at, and making someone
   * acknowledge a dead room before it will let them out is a chore. Ten seconds
   * is long enough to read what happened and still tap through early — the
   * button stays live the whole time, so this shortens the exit rather than
   * taking it over.
   *
   * ONLY `room_ended`. A kick or a ban has to be read; hurrying someone off that
   * screen is how they end up not knowing why they cannot rejoin.
   */
  useEffect(() => {
    if (eject?.kind !== "room_ended") {
      setEjectCountdown(null);
      return;
    }
    setEjectCountdown(ROOM_ENDED_GRACE_SECONDS);
    const tick = setInterval(() => {
      const next = (useRoomUIStore.getState().ejectCountdown ?? 1) - 1;
      setEjectCountdown(next);
      if (next <= 0) {
        clearInterval(tick);
        leaveForLynksRef.current();
      }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eject?.kind]);

  // ── Cleanup on unmount (mirrors native leave/reset) ───────────────────────
  // `useLynkBroadcast` tears its own transport down on unmount; this is belt
  // and braces plus the domain reset. A stream still publishing after you
  // navigate away is a privacy incident, so it is called explicitly.
  useEffect(() => {
    return () => {
      try {
        lynkRef.current.end();
      } catch {
        // ignore
      }
      resetRoomStore();
    };
  }, [resetRoomStore]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    // Muting yourself is always allowed. Turning the microphone back ON is not,
    // while the host is holding the mute — otherwise the lock is decoration.
    const turningOn = !lynkRef.current.micEnabled;
    if (
      turningOn &&
      !canSelfUnmute({ locked: hostMuteLocked }, isHostRef.current)
    ) {
      showToast("info", "Muted by host", HOST_MUTE_COPY.blocked);
      return;
    }
    lynkRef.current.setMicEnabled(turningOn);
  }, [hostMuteLocked, showToast]);

  const toggleCamera = useCallback(() => {
    lynkRef.current.setCameraEnabled(!lynkRef.current.cameraEnabled);
  }, []);

  /**
   * Exit to the Lynks list — where every Lynk is — rather than `router.back()`.
   * Back is wherever you happened to come from, which for a deep link or an
   * accepted invite is outside the app entirely.
   */
  const leaveForLynks = useCallback(() => {
    setEject(null);
    setEjectCountdown(null);
    try {
      lynkRef.current.end();
    } catch {
      // The room is already gone; leaving is what matters.
    }
    resetRoomStore();
    endRoomHistory(id);
    router.push(LYNKS_LIST_ROUTE);
  }, [endRoomHistory, id, resetRoomStore, router, setEject, setEjectCountdown]);
  // Ref so the countdown's interval never captures a stale closure.
  const leaveForLynksRef = useRef(leaveForLynks);
  leaveForLynksRef.current = leaveForLynks;

  // The event this room belongs to, if any.
  //
  // A room reached from an event page took the event's title and then said
  // nothing about it — so once you were inside, the room was a video call with
  // a familiar name and no way back to the thing it was for. Read-only: no
  // event just means no chip.
  // A host leaving ends the room for everyone. Without a confirm, the header
  // back arrow was a one-tap room-killer — and there was no share control, so
  // the only way to invite someone was a button that closed the Lynk they
  // were inviting people to. That is the "Lynk closed" report: hosts backed
  // out to DM the link, the room ended behind them, and the link went dead.
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [lynkEvent, setLynkEvent] = useState<{
    id: string;
    title: string;
    slug: string | null;
  } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const found = await eventsApi.getEventByLynkRoom(id);
      if (!cancelled) setLynkEvent(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

  const leavingRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const leaveLifetimeRef = useRef({ active: false, epoch: 0 });
  useEffect(() => {
    leaveLifetimeRef.current = { active: true, epoch: leaveLifetimeRef.current.epoch + 1 };
    return () => {
      leaveLifetimeRef.current = { active: false, epoch: leaveLifetimeRef.current.epoch + 1 };
    };
  }, []);
  const queueGuestLeave = useCallback(() => {
    const owner = useAuthStore.getState().user?.authId || useAuthStore.getState().user?.id || "";
    if (!owner || owner !== accountKey) return Promise.resolve();
    let ownerUnchanged = true;
    // This observer outlives navigation until the queued departure settles.
    // New mounts share the lane, so an old leave cannot evict their admission.
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (authenticatedLynkAccount(next) !== authenticatedLynkAccount(previous)) ownerUnchanged = false;
    });
    const isOwnerCurrent = () => ownerUnchanged && authenticatedLynkAccount(useAuthStore.getState()) === owner;
    return withRoomAdmissionLock(owner, id, async () => {
      if (isOwnerCurrent()) await sneakyLynkApi.leaveRoom(id, { isCurrent: isOwnerCurrent });
    }).finally(unsubscribe);
  }, [accountKey, id]);
  const doLeave = useCallback(() => {
    if (!leaveLifetimeRef.current.active || leavingRef.current) return;
    const epoch = ++leaveLifetimeRef.current.epoch;
    const isCurrent = () => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch;
    leavingRef.current = true;
    setIsLeaving(true);
    void leaveRoomSafely({
      isCurrent,
      isHost: isHostRef.current,
      endRoom: () => sneakyLynkApi.endRoom(id),
      leaveRoom: queueGuestLeave,
      onFailure: (message) => showToast("error", "Couldn't close Lynk", message),
      exit: () => {
        setAdmission(null);
        try { lynkRef.current.end(); } catch { /* Already stopped. */ }
        resetRoomStore();
        endRoomHistory(id);
        router.push(LYNKS_LIST_ROUTE);
      },
    }).finally(() => { if (isCurrent()) { leavingRef.current = false; setIsLeaving(false); } });
  }, [id, queueGuestLeave, endRoomHistory, resetRoomStore, router, showToast]);

  // The leave buttons never end a room silently: a host confirming is a host
  // who meant it. Everyone else still leaves instantly.
  const requestLeave = useCallback(() => {
    if (leavingRef.current) return;
    if (isHostRef.current) {
      setShowEndConfirm(true);
      return;
    }
    doLeave();
  }, [doLeave]);

  // The system share sheet stays in this room. A copied private link is not
  // an invitation grant, and an abandoned sheet must not copy after leaving.
  const shareInFlightRef = useRef(false);
  const shareContextRef = useRef({ admitted, eject, status: roomSnapshot?.status });
  shareContextRef.current = { admitted, eject, status: roomSnapshot?.status };
  const shareRoom = useCallback(async () => {
    const ownerEpoch = accountEpochRef.current;
    const leaveEpoch = leaveLifetimeRef.current.epoch;
    const isCurrent = () => roomMountedRef.current && !leavingRef.current && leaveLifetimeRef.current.active &&
      leaveLifetimeRef.current.epoch === leaveEpoch && accountEpochRef.current === ownerEpoch &&
      currentAccountKeyRef.current === accountKey && shareContextRef.current.admitted && !shareContextRef.current.eject &&
      shareContextRef.current.status !== "ended";
    if (shareInFlightRef.current || !isCurrent()) return;
    const url = lynkRoomShareUrl(id);
    if (!url) {
      showToast("info", "This space cannot be shared", "Create a Lynk to invite people into a shared room.");
      return;
    }
    shareInFlightRef.current = true;
    const title = roomSnapshot?.title || paramTitle || getLynkDisplayName();
    const copy = roomShareCopy(title, roomSnapshot?.isPublic);
    try {
      const result = await shareRoomLink({ title, text: copy.text, url, isCurrent,
        share: navigator.share ? data => navigator.share(data) : undefined,
        copy: navigator.clipboard?.writeText ? text => navigator.clipboard.writeText(text) : undefined });
      if (result === "copied") showToast("success", "Lynk link copied", copy.confirmation);
      if (result === "failed") showToast("error", "Couldn't share this Lynk", "Try sharing again from a supported browser.");
    } finally { shareInFlightRef.current = false; }
  }, [accountKey, id, roomSnapshot?.title, roomSnapshot?.isPublic, paramTitle, showToast]);

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
  // which is what the legacy-host fallback expects. Server deadlines display
  // for every role regardless of their personal subscription.
  const resolvedIsPaidHost = entitlementsLoading
    ? null
    : entitlements.sessionMinutes === null;

  useEffect(() => {
    if (phase !== "connected" || !isHostRef.current) return;
    if (timerStartedAt == null) setTimerStartedAt(Date.now());
    if (resolvedIsPaidHost == null || isPaidHost === resolvedIsPaidHost) return;
    setIsPaidHost(resolvedIsPaidHost);
  }, [phase, resolvedIsPaidHost, isPaidHost, timerStartedAt, setIsPaidHost, setTimerStartedAt]);

  // ── Host moderation: authoritative roles, shared target locks ────────────
  const moderationContextRef = useRef({ members, localUserId, admitted, eject });
  moderationContextRef.current = { members, localUserId, admitted, eject };
  const moderationPendingRef = useRef(new Set<string>());
  const [moderationPending, setModerationPending] = useState<ReadonlySet<string>>(() => new Set());
  type ModerationAction = "promote" | "demote" | "remove" | "mute" | "unmute" | "muteAll" | "unmuteAll";
  const runModeration = useCallback(async (action: ModerationAction, targetId?: string): Promise<boolean> => {
    const ownerEpoch = accountEpochRef.current;
    const leaveEpoch = leaveLifetimeRef.current.epoch;
    const owner = accountKey;
    const bulk = action === "muteAll" || action === "unmuteAll";
    const lock = bulk ? "*" : targetId!;
    const ownsAction = () => roomMountedRef.current && !leavingRef.current && leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === leaveEpoch && accountEpochRef.current === ownerEpoch &&
      (useAuthStore.getState().user?.authId || useAuthStore.getState().user?.id || "") === owner &&
      moderationContextRef.current.admitted && !moderationContextRef.current.eject;
    const allowed = () => {
      if (!ownsAction()) return false;
      const current = moderationContextRef.current;
      const actor = current.members.find(member => member.userId === current.localUserId && member.status === "active");
      if (bulk) return actor?.role === "host";
      const target = current.members.find(member => member.userId === targetId && member.status === "active");
      if (!actor || !target) return false;
      const capabilities = participantModeration(actor.role, actor.userId, target.userId, target.role);
      if (action === "promote") return capabilities.changeRole && target.role !== "co-host";
      if (action === "demote") return capabilities.changeRole && target.role === "co-host";
      return action === "remove" ? capabilities.remove : capabilities.mute;
    };
    if (!allowed() || moderationPendingRef.current.has(lock) || moderationPendingRef.current.has("*") || (bulk && moderationPendingRef.current.size > 0)) return false;
    moderationPendingRef.current.add(lock);
    setModerationPending(new Set(moderationPendingRef.current));
    const options = { isCurrent: allowed };
    try {
      const result = action === "promote" || action === "demote"
        ? await videoApi.changeRole({ roomId: id, targetUserId: targetId!, newRole: action === "promote" ? "co-host" : "participant" }, options)
        : action === "remove" ? await videoApi.kickUser({ roomId: id, targetUserId: targetId! }, options)
        : action === "mute" ? await videoApi.mutePeer({ roomId: id, targetUserId: targetId! }, options)
        : action === "unmute" ? await videoApi.unmutePeer({ roomId: id, targetUserId: targetId! }, options)
        : action === "muteAll" ? await videoApi.muteAll(id, options)
        : await videoApi.unmuteAll(id, options);
      if (!ownsAction()) return false;
      if (!result.ok) {
        showToast("error", "Change not saved", "The room or your permissions may have changed. Try again.");
        return false;
      }
      // No guessed co-host state. The authoritative roster updates the badge
      // and permissions. A failed promotion leaves its raised-hand entry intact.
      if (action === "promote" && targetId) setRaisedHand(targetId, false);
      if (action === "muteAll") showToast("success", "Muted everyone", "Participants are muted. They can turn their microphones off at any time.");
      if (action === "unmuteAll") showToast("success", "Microphone controls restored", "Participants can choose to unmute themselves.");
      return true;
    } catch {
      if (ownsAction()) showToast("error", "Change not saved", "Check your connection and try again.");
      return false;
    } finally {
      moderationPendingRef.current.delete(lock);
      if (roomMountedRef.current) setModerationPending(new Set(moderationPendingRef.current));
    }
  }, [accountKey, id, setRaisedHand, showToast]);
  const promote = useCallback((userId: string) => runModeration("promote", userId), [runModeration]);
  const demote = useCallback((userId: string) => runModeration("demote", userId), [runModeration]);
  const kick = useCallback((userId: string) => runModeration("remove", userId), [runModeration]);
  const muteOne = useCallback((userId: string) => runModeration("mute", userId), [runModeration]);
  const unmuteOne = useCallback((userId: string) => runModeration("unmute", userId), [runModeration]);
  const muteAll = useCallback(() => runModeration("muteAll"), [runModeration]);
  const unmuteAll = useCallback(() => runModeration("unmuteAll"), [runModeration]);
  const dismissHand = useCallback((userId: string) => {
    if (!isHostRef.current || leavingRef.current || moderationPendingRef.current.has("*") || moderationPendingRef.current.has(userId)) return;
    setRaisedHand(userId, false);
  }, [setRaisedHand]);
  const dismissAllHands = useCallback(() => {
    if (!isHostRef.current || leavingRef.current || moderationPendingRef.current.size > 0) return;
    clearRaisedHands();
    closeHandQueue();
  }, [clearRaisedHands, closeHandQueue]);

  const onUpgrade = useCallback(() => {
    setShowTimeUp(false);
    router.push("/feed/sneaky-lynk/billing");
  }, [router, setShowTimeUp]);

  // ── Voice activity ────────────────────────────────────────────────────────
  // Own mic → RMS + hysteresis, locally. Everyone else's speaking state arrives
  // on the room's Supabase channel because MoQ carries no VAD and `@moq/watch`
  // gives no analyser for a remote publisher's decoded audio. See
  // `lib/lynk/speaking-presence.ts`.
  const isSelfSpeaking =
    useSpeakingDetection(lynk.localAudioStream) && isMicOn;
  const remoteSpeaking = useSpeakingPresence({
    roomId: admitted ? id : undefined,
    // Anonymous speakers use the same public peer id as their media path.
    userId: speakingSenderId(currentUser),
    speaking: isSelfSpeaking,
  });
  const speakingByUserId: Record<string, boolean> = {};
  for (const member of members) {
    speakingByUserId[member.userId] = !!remoteSpeaking[peerIdForMember(member.userId, member.anonLabel)];
  }
  if (localUserId) speakingByUserId[localUserId] = isSelfSpeaking;

  // ── Build tiles: local capture + roster × discovered MoQ publishers ───────
  // A MoQ path carries no metadata, so identity is the Supabase roster and the
  // join key is the peer id BOTH sides derive from the user — `peerIdForMember`
  // mirrors `peerIdFor` in the `lynk-moq-token` edge function.
  const localName = joinAnonymous
    ? "You"
    : authUser?.username || authUser?.name || "You";

  const publisherByPeerId = new Map(lynk.coPublishers.map((p) => [p.peerId, p]));
  const remoteTiles: Tile[] = members
    .filter((m) => m.status === "active" && m.userId !== localUserId)
    .map((member) => {
      const publisher = publisherByPeerId.get(
        peerIdForMember(member.userId, member.anonLabel),
      );
      return {
        key: member.userId,
        name: getSneakyUserLabel(member),
        avatar: member.isAnonymous ? undefined : member.avatar,
        isLocal: false,
        isHost: member.role === "host",
        isCoHost: member.role === "co-host",
        videoStream: null,
        // Mounting the canvas is what subscribes to this publisher — audio
        // included — so it is attached for every publisher, camera or not.
        canvasPath: publisher?.path,
        attachCanvas: lynk.attachCanvas,
        // Video readiness comes from the selected rendition and decoded frame,
        // not path discovery (an audio-only publisher still has a path).
        // Mic availability remains discovery-based; speaking is signaled.
        isCameraOn: publisher?.videoAvailable === true,
        isMicOn: !!publisher,
        isSpeaking: !!speakingByUserId[member.userId],
        isPublisher: isPublisherRole(member.role),
      } satisfies Tile;
    });

  const localTile: Tile = {
    key: "local",
    name: localName,
    avatar: joinAnonymous ? undefined : authUser?.avatar || undefined,
    isLocal: true,
    isHost: isHostRef.current,
    isCoHost: localRole === "co-host",
    videoStream: lynk.localStream,
    isCameraOn,
    isMicOn,
    isSpeaking: isSelfSpeaking,
  };

  // Who belongs ON the stage: the people who can actually publish. Everyone
  // else is an audience member and belongs in the row underneath.
  //
  // These were the same list, so every remote participant rendered TWICE — a
  // video tile in the grid AND an avatar in "In the room". A Lynk is speakers
  // on a stage with listeners below it; the screen was not saying that.
  const remotePublisherTiles = remoteTiles.filter((t) => t.isPublisher);
  const listenerTiles = remoteTiles.filter((t) => !t.isPublisher);

  // Keep host-first ordering for the stacked focus and paged guest gallery.
  // Roles and local identity stay attached to the same keyed media tiles.
  const stageTiles = [localTile, ...remotePublisherTiles].sort(
    (a, b) => Number(b.isHost) - Number(a.isHost) ||
      Number(b.isCoHost) - Number(a.isCoHost) ||
      a.key.localeCompare(b.key),
  );
  const roomTitle = roomSnapshot?.title || paramTitle || getLynkDisplayName();
  const participantCount = Math.max(
    stageTiles.length,
    members.filter((m) => m.status === "active").length,
  );

  // Listener grid (TanStack Virtual). For an audio room the remote peers list
  // can grow large; virtualize it. Rendered as a horizontal row of avatars.
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: listenerTiles.length,
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
  if (phase === "waiting") {
    const copy = eventWaitingCopy(eventWaiting.status);
    const leaveLobby = () => { eventWaiting.cancel(); router.push(LYNKS_LIST_ROUTE); };
    return (
      <RoomShell title="Event Lynk" onBack={leaveLobby}>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-10" data-testid="lynk-waiting-room">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#8A40CF]/15 via-[#10121d] to-[#3FDCFF]/5 p-6 sm:p-8">
            <p className="mb-7 text-xs font-semibold tracking-[0.18em] text-[#9DEBFF]">{copy.eyebrow}</p>
            <span className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#3FDCFF]/20 bg-[#3FDCFF]/10"><Radio size={28} className="text-[#3FDCFF]" aria-hidden="true" /></span>
            <h2 className="mb-3 break-words text-3xl font-semibold tracking-tight">{copy.title}</h2>
            <p className="text-sm leading-6 text-white/70">{copy.body}</p>
            <p role="status" aria-live="polite" className="my-6 rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-[#9DEBFF]">{copy.status}</p>
            <p className="text-sm leading-6 text-white/80">{copy.privacy}</p>
            <p className="mt-2 text-xs leading-5 text-white/55">{copy.capacity}</p>
            {eventWaiting.status === "reconnecting" ? <button type="button" onClick={eventWaiting.retry} className="mt-6 min-h-12 w-full rounded-xl bg-[#3FDCFF] px-4 font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Check again</button> : null}
            <button type="button" onClick={leaveLobby} className="mt-4 min-h-12 w-full rounded-xl border border-white/15 bg-white/5 px-6 py-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">Leave lobby</button>
          </div>
        </div>
      </RoomShell>
    );
  }

  if (phase === "app-only") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.push(LYNKS_LIST_ROUTE)}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#3FDCFF]/12 text-[#3FDCFF]">
            <Smartphone size={36} />
          </span>
          <h2 className="mb-3 text-2xl font-bold">This Lynk is app-only</h2>
          <p className="mb-8 max-w-md text-white/60">
            The host has limited this room to the DVNT app. Open the app to join
            with its additional screen-capture protections. No app can prevent
            someone recording with another device.
          </p>

          <a
            href={lynkRoomAppUrl(id) ?? undefined}
            className="w-full max-w-xs rounded-lg px-6 py-4 text-center font-bold text-black active:scale-95"
            style={{ backgroundColor: ACCENT }}
          >
            Open in the DVNT app
          </a>

          <p className="mt-4 max-w-xs text-xs leading-5 text-white/60">If the app doesn&apos;t open, install DVNT from your device&apos;s app store and reopen this invite.</p>

          <button
            type="button"
            onClick={() => router.push(LYNKS_LIST_ROUTE)}
            className="mt-8 rounded-lg bg-white/8 px-6 py-3 text-sm font-semibold active:scale-95"
          >
            Back to Lynks
          </button>
        </div>
      </RoomShell>
    );
  }

  if (phase === "closed") {
    return (
      <RoomShell title={roomTitle} onBack={() => router.push(LYNKS_LIST_ROUTE)}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/8">
            <Radio size={36} className="text-white/40" />
          </span>
          <h2 className="text-2xl font-bold mb-3">{roomUnavailableTitle(closedReason)}</h2>
          <p className="text-white/60 mb-8">{closedReason}</p>
          <button
            type="button"
            onClick={() => router.push(LYNKS_LIST_ROUTE)}
            className="rounded-lg bg-white/8 px-6 py-4 font-semibold active:scale-95"
          >
            Back to Lynks
          </button>
        </div>
      </RoomShell>
    );
  }

  if ((phase === "error" || fullRoomRetry.retrying) && !admitted) {
    const feedback = webJoinFeedback(joinFailure);
    const full = joinFailure?.reason === "room_full";
    const leaveEntry = () => { fullRoomRetry.stop(); router.push(LYNKS_LIST_ROUTE); };
    return (
      <RoomShell title={roomTitle} onBack={leaveEntry}>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10"><Radio size={28} className="text-amber-200" aria-hidden="true" /></span>
          <h2 className="mb-3 text-2xl font-bold">{feedback.title}</h2>
          <p role="alert" className="mb-6 text-sm leading-6 text-white/70">{feedback.body}</p>
          {full ? <div className="mb-5 w-full rounded-xl border border-white/15 bg-white/5 p-4 text-left">
            <p className="text-sm leading-6 text-white/80">Try automatically while this page stays open. You'll join with your reviewed camera, microphone and identity choices when an attempt succeeds.</p>
            <p className="mt-2 text-xs leading-5 text-white/60">Retries slow to every 30 seconds. This isn't a queue or a reserved seat. Switching tabs stops automatic tries.</p>
            <p role="status" className="mt-3 text-sm text-[#8DEAFF]">{fullRoomRetry.retrying ? (fullRoomRetry.enabled ? "Trying to join…" : "Finishing the current request. Your camera and microphone stay off.") : fullRoomRetry.enabled ? `Next attempt in ${fullRoomRetry.secondsUntilRetry}s` : "Automatic tries are off."}</p>
            <button type="button" onClick={fullRoomRetry.enabled ? fullRoomRetry.stop : fullRoomRetry.start} disabled={!fullRoomRetry.enabled && fullRoomRetry.retrying} className="mt-3 min-h-11 w-full rounded-lg bg-white/10 px-3 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">{fullRoomRetry.enabled ? "Stop automatic tries" : "Try automatically"}</button>
          </div> : null}
          {!full && fullRoomRetry.retrying ? <p role="status" className="mb-4 text-sm leading-6 text-amber-200">The previous request is still settling. Your camera and microphone stay off. You can return to Lynks now.</p> : null}
          {feedback.retry ? <button type="button" disabled={fullRoomRetry.retrying || (full && fullRoomRetry.cooldownSeconds > 0)} onClick={() => {
            if (full) { void fullRoomRetry.retryNow(); return; }
            if (useRoomUIStore.getState().phase !== "error") return;
            joinFiredRef.current = false;
            joinCompletedRef.current = false;
            setPhase("joining");
            setJoinAttempt(value => value + 1);
          }} className="min-h-12 w-full rounded-xl bg-[#3FDCFF] px-6 py-3 font-semibold text-black disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">{fullRoomRetry.retrying ? "Trying again…" : full && fullRoomRetry.cooldownSeconds > 0 ? `Try again in ${fullRoomRetry.cooldownSeconds}s` : "Try again"}</button> : null}
          <button type="button" onClick={leaveEntry} className="mt-3 min-h-11 w-full rounded-xl bg-white/8 px-6 py-3 font-semibold hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">Back to Lynks</button>
        </div>
      </RoomShell>
    );
  }

  const connecting = phase === "joining" || phase === "connecting";
  const connectionFeedback = webConnectionFeedback(lynk.state);
  const connectionPhase = lynk.state === "error" || lynk.state === "ended" ? "disconnected" : bannerPhaseFor(session);
  const isHost = isHostRef.current;
  const raisedHandCount = raisedHandOrder.length;
  // The server decides whether this session is limited; the client displays it.
  // Falls back to the entitlement read only when the backend returned no
  // endsAt field at all (pre-deploy), which is the only case the client still
  // has to guess.
  const showTimer = serverEndsAt != null ||
    (serverEndsAt === undefined && isHost && timerStartedAt != null && isPaidHost === false);

  return (
    <RoomViewport>
    <SecureCaptureBoundary
      enabled={phase === "connected" || phase === "joining" || phase === "connecting"}
      roomId={id}
      sessionId={roomSnapshot?.fishjamRoomId}
      userId={authUser?.id}
      userHandle={joinAnonymous ? currentUser.anonLabel ?? "anon" : authUser?.username}
      mode="sneaky-lynk"
      blackoutOnBlur
      blackoutOnVisibilityHidden
      watermark={false}
      logEvents
      onCaptureAttempt={(kind) => captureBroadcast.notifyLocalCapture(kind)}
    >
      <main
        // Observable seam, same idea as `data-tile` / `data-speaking`: the role
        // and the publish capability are what decide whether anyone can see or
        // hear you, and they were previously readable only from React state —
        // so a test could see a silent room but never say WHY it was silent.
        data-room-phase={phase}
        data-room-role={localRole ?? "none"}
        data-can-publish={canPublish ? "true" : "false"}
        data-camera-on={isCameraOn ? "true" : "false"}
        data-has-local-stream={lynk.localStream ? "true" : "false"}
        className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#06070d] text-white"
      >
      {/* The session machine is the single source now — it is what knows a
          first join from a reconnect, and what is driving the retries. */}
      <ConnectionBanner phase={connectionPhase} detail={connectionFeedback.detail} />
      <CaptureNotificationBannerWeb />

      {/* Only room content scrolls. The dock never competes with a tall header,
          listener row, enlarged text, or a short landscape viewport. */}
      <div data-room-content className="relative isolate z-0 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <CaptureErrorBanner error={lynk.captureError} onRetry={lynk.retryCapture} />
      <RoomHeader
        title={roomTitle}
        connecting={connectionFeedback.attention}
        connectionLabel={connectionFeedback.label}
        anonymous={joinAnonymous}
        isHost={isHost}
        participantCount={participantCount}
        raisedHandCount={raisedHandCount}
        event={lynkEvent}
        onBack={requestLeave}
        onShare={shareRoom}
        onParticipants={() => setParticipantsOpen(true)}
        onDevices={() => { closeChat(); closeHandQueue(); setParticipantsOpen(false); setDeviceSettingsOpen(true); }}
        onHandQueue={openHandQueue}
        onMuteAll={muteAll}
        onUnmuteAll={unmuteAll}
        onEvent={() => lynkEvent && router.push(`/feed/events/${lynkEvent.id}`)}
        timer={showTimer ? <RoomTimer
          startedAt={timerStartedAt ?? undefined}
          endsAt={serverEndsAt}
          compact
          onTimeUp={() => {
            if (isHost) setShowTimeUp(true);
            // Every participant observes the same server deadline.
            lynkRef.current.setCameraEnabled(false);
            lynkRef.current.setMicEnabled(false);
          }}
        /> : null}
      />
      {admitted && audioOutputState.message && !isDeviceSettingsOpen ? (
        <div role={audioOutputState.phase === "error" ? "alert" : "status"} className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/15 bg-amber-300/10 px-4 py-3 text-sm text-amber-100" data-audio-output-notice>
          <p className="min-w-0 flex-1 leading-5">{audioOutputState.message}</p>
          <button type="button" onClick={() => { closeChat(); closeHandQueue(); setParticipantsOpen(false); setDeviceSettingsOpen(true); }} className="min-h-11 rounded-lg bg-white/10 px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">Audio settings</button>
        </div>
      ) : null}
      {admitted && !rosterReady && (
        <div className="mx-4 mb-3 rounded-xl bg-amber-400/10 px-4 py-3 text-sm text-amber-100" role="status" aria-live="polite" data-testid="lynk-roster-pending">
          <p className="font-semibold">{rosterError ? "Couldn't load participants" : "Connecting participants…"}</p>
          <p className="mt-1">{rosterError
            ? "The participant service is unavailable. We're retrying automatically; other people may not appear yet."
            : "Waiting for the room's participant list so everyone can appear."}</p>
          <p className="mt-1">Your camera and microphone controls remain active below.</p>
        </div>
      )}


      {/* Standing disclosure — own row so the copy is never truncated by
          the three-column header. Renders only while a web viewer is in
          the room. */}
      <div className="relative z-10 shrink-0 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] pb-1 empty:hidden [@media(max-height:500px)_and_(min-width:600px)]:pb-0">
        <WebViewerDisclosureChip />
      </div>

      {connecting ? (
        <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-4">
          <div aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin motion-reduce:animate-none" />
          <p role="status" className="font-semibold">Joining your Lynk…</p>
          <p className="max-w-sm px-5 text-center text-sm text-white/60">Checking your place in the room. Camera and microphone controls remain available below.</p>
        </div>
      ) : (
        <>
           {/* Host above a single guest or swipeable guest pages. Two people
               stay vertically stacked even on desktop and in landscape. */}
           <section
             data-stage-participants={stageTiles.length}
             className={`relative flex flex-1 flex-col items-center justify-center gap-2 pl-[max(12px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))] py-2 [@media(max-height:500px)_and_(min-width:600px)]:py-1 ${stageTiles.length > 2 ? "min-h-80" : "min-h-40"}`}
           >
             {rosterReady && stageTiles.length === 1 ? (
               <div role="status" className="flex shrink-0 flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#111522]/85 px-3 py-2 text-xs text-white/70">
                 <span>Just you here — invite someone to join.</span>
                 <button
                   type="button"
                   onClick={shareRoom}
                   className="rounded-lg bg-[#3FDCFF]/15 px-3 py-1.5 font-semibold text-[#3FDCFF] hover:bg-[#3FDCFF]/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
                 >
                   Copy invite / Share
                 </button>
               </div>
             ) : null}
             <RoomStage tiles={stageTiles} />
           </section>

          {/* Listener row — TanStack Virtual (horizontal) */}
          {listenerTiles.length > 0 ? (
            <div className="shrink-0 pl-[max(16px,env(safe-area-inset-left))] pr-[max(16px,env(safe-area-inset-right))] pb-1" data-room-listeners>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/40">
                Listeners · {listenerTiles.length} · Swipe for more
              </p>
              <div ref={listScrollRef} tabIndex={0} role="region" aria-label="Listeners. Scroll horizontally to see everyone." className="overflow-x-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]" style={{ height: 96 }}>
                <div
                  style={{ width: rowVirtualizer.getTotalSize(), height: "100%", position: "relative" }}
                >
                  {rowVirtualizer.getVirtualItems().map((vItem) => {
                    const t = listenerTiles[vItem.index];
                    return (
                      <div
                        key={t.key}
                        // Mirrors `data-tile` on the stage: the audience is a
                        // distinct place a participant can be, so it has to be
                        // distinguishable from "on stage" by something other
                        // than a human reading avatars.
                        data-listener={t.key}
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

      </div>

      {/* One renderer. The GPU overlay used to suppress this one whenever it
          reported available, so a canvas that failed to initialise made
          reactions silently invisible. */}
      <FloatingReactions reactions={reactions} />

      {/* Controls bar */}
      <footer data-room-controls className="relative z-30 flex shrink-0 flex-col items-center gap-1 [@media(max-height:500px)_and_(min-width:600px)]:flex-row border-t border-white/8 bg-[#090b15]/95 pt-1 sm:gap-2" style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 8px)", paddingLeft: "max(8px, env(safe-area-inset-left))", paddingRight: "max(8px, env(safe-area-inset-right))" }}>
        <div className="flex w-full items-center justify-center gap-1 min-[360px]:gap-2 sm:gap-4 [@media(max-height:500px)_and_(min-width:600px)]:w-auto [@media(max-height:500px)_and_(min-width:600px)]:flex-1">
          <ControlButton
            onClick={toggleMic}
            active={isMicOn}
            disabled={!canPublish}
            label={
              hostMuteLocked
                ? "Muted by host"
                : !canPublish ? "Microphone unavailable in listener mode"
                : lynk.micEnabled ? "Mute" : "Unmute"
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
              disabled={!canPublish}
              label={!canPublish ? "Camera unavailable in listener mode" : lynk.cameraEnabled ? "Camera off" : "Camera on"}
            >
              {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
            </ControlButton>
          ) : null}

          <ControlButton onClick={toggleHand} active={isHandRaised} label={isHandRaised ? "Lower hand" : "Raise hand"}>
            <Hand size={24} color={isHandRaised ? ACCENT : "#fff"} />
          </ControlButton>

          <ControlButton
            onClick={isChatOpen ? closeChat : openChat}
            active={isChatOpen}
            label="Chat"
          >
            <MessageCircle size={24} />
          </ControlButton>

          <ReactionsPicker onSend={sendReaction} overlayOpen={isChatOpen || isHandQueueOpen || isParticipantsOpen || isDeviceSettingsOpen || showEndConfirm || showTimeUp} />
          <ControlButton onClick={requestLeave} danger disabled={isLeaving} label={isLeaving ? "Leaving Lynk" : "Leave Lynk"}>
            <PhoneOff size={24} />
          </ControlButton>
        </div>
        <p role="status" className="max-w-full px-2 text-center text-[11px] leading-4 text-white/60 [@media(max-height:500px)_and_(min-width:600px)]:max-w-[180px] [@media(max-height:500px)_and_(min-width:600px)]:text-left">
          {isLeaving ? "Leaving · " : ""}
          {!canPublish ? "Listening · Raise your hand to speak" : hostMuteLocked ? "Microphone muted by host" : !lynk.micEnabled ? "Microphone muted" : lynk.microphoneError ? "Microphone unavailable" : isMicOn ? "Microphone on" : "Waiting for microphone"}
          {roomHasVideo && canPublish ? ` · ${!lynk.cameraEnabled ? "Camera off" : lynk.cameraError ? "Camera unavailable" : isCameraOn ? "Camera on" : "Waiting for camera"}` : ""}
        </p>
      </footer>

      <SidePanel open={isDeviceSettingsOpen} onClose={() => setDeviceSettingsOpen(false)} title="Audio & camera">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
          <DeviceSelectors roomHasVideo={roomHasVideo} refreshKey={`${lynk.cameraActive}:${lynk.microphoneActive}`} />
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm">
            <p className="font-semibold">Your microphone</p>
            <p role="status" className="mt-1 text-white/70">{!canPublish ? "You are listening. Raise your hand to speak." : hostMuteLocked ? "Muted by host" : !lynk.micEnabled ? "Muted" : lynk.microphoneError ? "Unavailable. Check permissions or choose another device." : isMicOn ? "Connected" : "Waiting for microphone access or audio"}</p>
            <div aria-hidden="true" className="mt-3 flex h-4 items-end gap-1">{[0, 1, 2, 3, 4].map(bar => <span key={bar} className={`w-2 rounded-sm ${isSelfSpeaking ? "bg-[#3FDCFF]" : "bg-white/15"}`} style={{ height: 4 + bar * 3 }} />)}</div>
            <p className="mt-2 text-xs text-white/60">The bars light up when your microphone picks up speech. This isn't a guarantee others can hear you.</p>
          </div>
          <p className="text-xs leading-5 text-white/60">Device changes stay on this device for this room. Muted devices stay muted. Your room identity and anonymity choice are unchanged.</p>
        </div>
      </SidePanel>

      {/* Chat (side-panel) */}
      <ChatPanel
        roomId={id}
        open={isChatOpen}
        onClose={closeChat}
        comments={comments}
        onSend={sendChat}
        currentUserId={localUserId}
        loading={chatLoading}
        error={chatError}
        disabled={!admitted}
      />

      {/* Hand-queue moderation (host) */}
      <HandQueuePanel
        open={isHandQueueOpen && isHost}
        onClose={closeHandQueue}
        order={raisedHandOrder}
        externalPending={moderationPending}
        localUserId={localUserId}
        members={members}
        onInviteToSpeak={promote}
        onLowerHand={dismissHand}
        onLowerAll={dismissAllHands}
      />

      {/* Participants list + moderation */}
      <ParticipantsPanel
        externalPending={moderationPending}
        open={isParticipantsOpen}
        onClose={() => setParticipantsOpen(false)}
        members={members}
        localUserId={localUserId}
        onPromote={promote}
        onDemote={demote}
        onKick={kick}
        onMute={muteOne}
        onUnmute={unmuteOne}
        onMuteAll={muteAll}
        speakingByUserId={speakingByUserId}
      />

      {/* Free-host duration-limit paywall */}
      <TimeUpDialog open={showTimeUp} onUpgrade={onUpgrade} onLeave={doLeave} />

      {/* Host exit = end for everyone — confirm instead of a one-tap kill. */}
      <Dialog
        open={showEndConfirm}
        onClose={() => setShowEndConfirm(false)}
        title="End this Lynk?"
        maxWidth={400}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowEndConfirm(false)}
              className="rounded-xl bg-white/8 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/15"
            >
              Stay
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEndConfirm(false);
                doLeave();
              }}
              className="rounded-xl bg-[#F43F5E] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#E11D48]"
            >
              End for everyone
            </button>
          </>
        }
      >
        <p className="text-sm text-white/70">
          You&apos;re hosting. Leaving ends the Lynk for everyone, including
          co-hosts. Hosting does not transfer automatically. To invite more
          people without leaving, use Share.
        </p>
      </Dialog>

      {/* Eject banner (kicked / banned / room ended) */}
      {eject ? (
        <EjectModal
          visible
          kind={eject.kind}
          reason={eject.reason}
          autoLeaveIn={eject.kind === "room_ended" ? ejectCountdown : null}
          onDismiss={leaveForLynks}
        />
      ) : null}
      </main>
    </SecureCaptureBoundary>
    </RoomViewport>
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
    <div className="flex min-h-dvh flex-col bg-[#06070d] text-white">
      <div
        className="flex items-center px-4 py-3 border-b border-white/8"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="h-11 w-11 shrink-0 rounded-xl bg-white/8 flex items-center justify-center hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <span className="flex-1 mx-4 truncate text-center text-[15px] font-semibold">{title}</span>
        <span className="w-11 shrink-0" />
      </div>
      {children}
    </div>
  );
}

// ── Public entry: pre-join gate → the room ───────────────────────────────────
export function SneakyLynkRoomScreen() {
  const router = useRouter();
  const params = useParams();
  const accountKey = useAuthStore((s) => authenticatedLynkAccount(s) ?? "");
  const authSettled = useAuthStore((s) => s._hasHydrated && s.authStatus !== "loading");
  const [accountGeneration, setAccountGeneration] = useState(0);
  const entryAccountEpochRef = useRef(0);
  const entryExitedRef = useRef(false);
  const joinIntentRef = useRef(0);
  useEffect(() => useAuthStore.subscribe((next, previous) => {
    if (authenticatedLynkAccount(next) === authenticatedLynkAccount(previous)) return;
    entryAccountEpochRef.current += 1;
    joinIntentRef.current += 1;
    setAccountGeneration(value => value + 1);
  }), []);
  useEffect(() => useRoomUIStore.subscribe((next, previous) => {
    if (next.joinAnonymous !== previous.joinAnonymous || next.joinCameraOn !== previous.joinCameraOn ||
      next.joinMicOn !== previous.joinMicOn || next.cameraDeviceId !== previous.cameraDeviceId ||
      next.microphoneDeviceId !== previous.microphoneDeviceId) joinIntentRef.current += 1;
  }), []);
  const search = useSearchParams();
  const id = normalizeLynkRoomId((params as any)?.id) ?? "";
  const paramTitle = search?.get("title") ?? undefined;
  const hasVideoParam = search?.get("hasVideo");
  const isHostParam = search?.get("isHost");

  // Default true unless explicitly "0" (deep-link recipients omit it).
  const isServerRoom = !id.startsWith("space-") && id !== "my-room";
  const isCreator = isHostParam === "1";
  // URL flags are navigation hints, never camera/microphone consent.
  // Hosts and accepted co-hosts review their arrival just like guests.
  const shouldGateJoin = isServerRoom;
  const scopeKey = JSON.stringify([id, accountKey, accountGeneration, shouldGateJoin]);
  const previousScopeKey = useRef(scopeKey);
  if (previousScopeKey.current !== scopeKey) {
    previousScopeKey.current = scopeKey;
    entryExitedRef.current = false;
    joinIntentRef.current += 1;
  }
  const entryScope = useRoomEntryScope(scopeKey);
  const accountEpoch = entryAccountEpochRef.current;
  const isCurrentEntry = useCallback(() => !entryExitedRef.current && entryAccountEpochRef.current === accountEpoch &&
    authenticatedLynkAccount(useAuthStore.getState()) === accountKey && entryScope.isCurrent(),
  [accountKey, accountEpoch, entryScope.isCurrent]);
  const handleBack = useCallback(() => {
    entryExitedRef.current = true;
    joinIntentRef.current += 1;
    useRoomUIStore.getState().setPhase("looking-up");
    router.push(LYNKS_LIST_ROUTE);
  }, [router]);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [entryIdentity, setEntryIdentity] = useState<RoomEntryIdentity>({ kind: "choice" });

  const phase = useRoomUIStore((s) => s.phase);
  const roomSnapshot = useRoomUIStore((s) => s.roomSnapshot);
  const roomHasVideo = roomSnapshot?.hasVideo ?? (hasVideoParam !== "0");
  const setPhase = useRoomUIStore((s) => s.setPhase);
  const setRoomSnapshot = useRoomUIStore((s) => s.setRoomSnapshot);
  const setClosed = useRoomUIStore((s) => s.setClosed);

  // Look up every server room before media and identity review.
  useEffect(() => {
    // The render-time scope gate prevents a stale connected phase from
    // mounting a new room/account before this parent effect runs.
    useRoomUIStore.getState().reset();
    entryScope.initialize();
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setLookupFailed(false);
    setEntryIdentity({ kind: "choice" });
    const cleanup = () => { cancelled = true; clearTimeout(timeout); useRoomUIStore.getState().reset(); };
    if (!accountKey) {
      setPhase("looking-up");
      return cleanup;
    }
    if (!id) {
      setClosed("This Lynk link is incomplete or invalid. Ask the host for a new link.");
      return cleanup;
    }
    if (!shouldGateJoin) {
      setPhase("connecting"); // local rooms have no server admission
      return cleanup;
    }
    setPhase("looking-up");
    timeout = setTimeout(() => {
      if (cancelled || !isCurrentEntry()) return;
      cancelled = true;
      setLookupFailed(true);
    }, 20000);
    (async () => {
      const [room, identity] = await Promise.all([
        sneakyLynkApi.getRoomById(id, { throwOnError: true }),
        getRoomEntryIdentity(id, { isCurrent: () => !cancelled && isCurrentEntry() }),
      ]);
      if (cancelled || !isCurrentEntry()) return;
      clearTimeout(timeout);
      if (!room) {
        setClosed("This Lynk is unavailable.");
      } else if (getRoomEntryStatus(room) === "ended") {
        setRoomSnapshot(room);
        setClosed("This Lynk has ended and can't be reopened.");
      } else {
        if (cancelled) return;
        setRoomSnapshot(room);
        setEntryIdentity(identity);
        if (identity.kind === "active") useRoomUIStore.getState().setJoinAnonymous(identity.anonymous);
        setPhase("prejoin");
      }
    })().catch(() => {
      if (cancelled || !isCurrentEntry()) return;
      clearTimeout(timeout);
      setLookupFailed(true);
    });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shouldGateJoin, accountKey, accountGeneration, entryScope.initialize, isCurrentEntry, lookupAttempt]);

  // Verified-only: joining a Lynk needs a verified account. The pre-join
  // screen stays up behind the popup.
  const guardVerified = useVerifiedGate();
  const handleJoin = useCallback(
    (anonymous: boolean, prepareJoin: () => void) => {
      if (!isCurrentEntry()) return;
      const intent = ++joinIntentRef.current;
      guardVerified("sneaky_lynk", () => {
        if (!isCurrentEntry() || joinIntentRef.current !== intent || useRoomUIStore.getState().joinAnonymous !== anonymous) return;
        completePreJoin({ anonymous, isCurrent: isCurrentEntry, prepareJoin });
      });
    },
    [guardVerified, isCurrentEntry],
  );

  const roomTitle = roomSnapshot?.title || paramTitle || getLynkDisplayName();

  if (!accountKey) {
    return <RoomShell title={getLynkDisplayName()} onBack={handleBack}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">{authSettled ? "Sign in to open this Lynk" : "Checking your account"}</h1>
        <p role="status" className="max-w-sm text-sm leading-6 text-white/60">Sneaky Lynk is for signed-in members. Your camera and microphone stay off.</p>
        {authSettled ? <button type="button" onClick={() => router.push(id ? `/auth/login?returnTo=${encodeURIComponent(`/feed/sneaky-lynk/room/${id}`)}` : "/auth/login")}
          className="min-h-12 rounded-xl bg-[#3FDCFF] px-6 py-3 font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Sign in</button> : null}
      </div>
    </RoomShell>;
  }

  if (!entryScope.ready || phase === "looking-up") {
    return (
      <RoomShell title={roomTitle} onBack={handleBack}>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
          {!lookupFailed ? <div aria-hidden="true" className="h-8 w-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin motion-reduce:animate-none" /> : <Radio size={32} className="text-amber-200" aria-hidden="true" />}
          <h1 className="text-xl font-semibold">{lookupFailed ? "Couldn't load this Lynk" : "Getting your Lynk ready"}</h1>
          <p role="status" className="text-sm leading-6 text-white/60">{lookupFailed ? "Check your connection and try again. Your camera and microphone haven't been opened." : "Checking the room before you choose how to join."}</p>
          {lookupFailed ? <button type="button" onClick={() => { setLookupFailed(false); setLookupAttempt(value => value + 1); }} className="min-h-12 w-full rounded-xl bg-[#3FDCFF] px-5 py-3 font-semibold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Try again</button> : null}
          <button type="button" onClick={handleBack} className="min-h-11 rounded-xl bg-white/8 px-5 py-3 text-sm font-semibold hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">Back to Lynks</button>
        </div>
      </RoomShell>
    );
  }

  if (phase === "closed") {
    return (
      <RoomShell title={roomTitle} onBack={handleBack}>
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/8">
            <Radio size={36} className="text-white/40" />
          </span>
          <h2 className="text-2xl font-bold mb-3">{roomUnavailableTitle(useRoomUIStore.getState().closedReason)}</h2>
          <p className="text-white/60 mb-8">{useRoomUIStore.getState().closedReason}</p>
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg bg-white/8 px-6 py-4 font-semibold active:scale-95"
          >
            Back to Lynks
          </button>
        </div>
      </RoomShell>
    );
  }

  // Gated server rooms wait for the user to tap "Join" before connecting.
  if (shouldGateJoin && phase === "prejoin") {
    return (
      <RoomShell title={roomTitle} onBack={handleBack}>
        <PreJoinSetup roomTitle={roomTitle} roomHasVideo={roomHasVideo} identity={entryIdentity} onJoin={handleJoin} />
      </RoomShell>
    );
  }

  // No provider: the MoQ hooks own their own connection and token, so the room
  // mounts directly.
  return (
    <RoomInner
      key={`${id}:${accountKey}`}
      id={id}
      paramTitle={paramTitle}
      roomHasVideo={roomHasVideo}
      isCreator={isCreator}
    />
  );
}

export default SneakyLynkRoomScreen;
