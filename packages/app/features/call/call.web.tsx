"use client";

/**
 * Call Room: WEB port of the native RTC screen
 * (`/deviant/app/(protected)/call/[roomId].tsx` + `useVideoCall`).
 *
 * The native path wraps `@fishjam-cloud/react-native-client` (native-only). On
 * web we use the REAL web SDK `@fishjam-cloud/react-client`: `FishjamProvider`,
 * `useConnection` (joinRoom/leaveRoom/peerStatus), `useCamera`, `useMicrophone`,
 * `usePeers`. The native `useVideoCall` hook can't be reused, so its join/leave
 * and peer→store sync logic is REPLICATED here against the web SDK.
 *
 * PORTABLE SHARED WIRING (identical to native):
 *   - Room/token: `callRoomsApi` (`call_create` / `call_join`), the PERSONAL
 *     CALLS stack, which WS-1 split from Sneaky Lynk. Calls do NOT go through
 *     `video_join_room` / `video_rooms`; that is the Lynk room model and it
 *     requires a uuid-keyed row a personal call never has.
 *   - `resolveFishjamAppId()` for the FishjamProvider `fishjamId`.
 *   - `useVideoRoomStore` (Zustand) is the single source of call state.
 *
 * HARD CONVENTIONS:
 *   - NativeWind interop OFF. Raw semantic HTML + Tailwind className only. No
 *     <View>/<Text>. State = Zustand only (no useState).
 *   - Tiles fill the screen (object-cover); local PiP rounded-2xl. Controls bar
 *     = circular icon buttons. bg color.ink/black, accent color.cyan, end-call color.signal.
 *   - Navigation via solito useRouter; leave → router.back().
 */

import { memo, useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import {
  FishjamProvider,
  useConnection,
  useCamera,
  useMicrophone,
  usePeers,
  useVAD,
  type PeerId,
} from "@fishjam-cloud/react-client";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  SwitchCamera,
  ChevronLeft,
  ChevronRight,
  Volume2,
} from "lucide-react";
import { callRoomsApi } from "@dvnt/app/lib/api/call-rooms";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVideoRoomStore } from "@dvnt/app/features/video";
import type { Participant } from "@dvnt/app/features/video/types";
import { color } from "@dvnt/app/lib/theme";
import { callSignalsApi } from "@dvnt/app/lib/api/call-signals";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { useCallUIStore } from "./call-ui-store";
import {
  findSpeakingPage,
  getGroupCallLayout,
  getGroupCallPage,
  moveGroupCallPage,
  orderGroupCallTiles,
} from "./group-call-layout";

const ACCENT = color.cyan;

// The one accent on the call stage: speaking rings, focus rings, page dots, the
// speaker chip, the stay-on-call button. #8EDBFF is what the native
// `GroupCallStage` uses, so the two platforms agree. The `ring-cyan-300` that
// used to sit on the arrows was a second blue doing the same job.
const CALL_ACCENT = "#8EDBFF";
// Tailwind compiles class strings at build time and cannot read CALL_ACCENT, so
// the focus ring repeats the literal. The two must stay the same colour.
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#8EDBFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#06070d]";

// 44x44, the touch minimum, because the same arrows are the only paging
// affordance in a phone browser where there is no PanResponder to swipe. A
// disabled arrow dims its glyph and drops its background; it does not also drop
// opacity, which would dim an already dimmed glyph twice.
const PAGER_ARROW = `flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/70 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/40 ${FOCUS_RING}`;

// The pager used to be pinned with a guessed `bottom-28 sm:bottom-24`, which
// collided with the controls on a short viewport and with the home indicator on
// an iPhone. These are what the control bar actually measures: one row of 56px
// circular buttons (h-14) sitting on the footer's own safe-area padding.
// Anything that has to clear the controls is derived from them.
const CONTROL_ROW_PX = 56;
const CONTROLS_SAFE_PAD =
  "max(2.5rem, calc(env(safe-area-inset-bottom) + 1rem))";
const CONTROLS_BAND = `calc(${CONTROLS_SAFE_PAD} + ${CONTROL_ROW_PX}px)`;
const TOP_BAND_PX = 80;
const PAGER_STRIP_PX = 44;
const GRID_GAP_PX = 8;
const GRID_PAD_X_PX = 12;

/**
 * The tile shape the grid and `orderGroupCallTiles` agree on.
 *
 * Declared rather than inferred: from inline literals TypeScript pins `isLocal`
 * to the remote tiles' `false` and then rejects the local tile's `true`.
 */
interface CallTile {
  id: string;
  name: string;
  avatar?: string;
  isLocal: boolean;
  isMicOn: boolean;
  hasVideo: boolean;
  stream: MediaStream | null | undefined;
}

// ── <video> tile: binds a MediaStream to a DOM video element via ref ──────────
// No useState: the stream is attached imperatively in a ref callback (the
// canonical web pattern, equivalent to native RTCView taking a stream).
const VideoTile = memo(function VideoTile({
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
      if (el && el.srcObject !== (stream ?? null)) {
        el.srcObject = stream ?? null;
      }
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
});

// ── Avatar fallback (rounded SQUARE, never circular, per DVNT rule) ──────────
function AvatarFallback({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    return (
      <img
        src={avatar}
        alt={name}
        className="h-24 w-24 rounded-2xl object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/10 text-3xl"
      style={{ fontFamily: "SpaceGrotesk-Bold", color: color.text }}
    >
      {(name?.[0] ?? "?").toUpperCase()}
    </div>
  );
}

// ── Circular control button (circles ALLOWED for the controls bar) ───────────
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
    ? "hover:opacity-90"
    : active
      ? "bg-white/15 hover:bg-white/25"
      : "bg-white/30 hover:bg-white/40";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={danger ? { backgroundColor: color.signal } : undefined}
      className={`flex h-14 w-14 items-center justify-center rounded-full text-white transition-colors ${bg}`}
    >
      {children}
    </button>
  );
}

// ── Inner screen, rendered INSIDE FishjamProvider so SDK hooks are valid ─────
function CallRoom({
  roomId,
  isOutgoing,
  participantIds,
  callType,
  recipientUsername,
  isGroup,
  chatId,
}: {
  roomId: string;
  isOutgoing: boolean;
  participantIds: string[];
  callType: "audio" | "video";
  recipientUsername: string;
  isGroup: boolean;
  chatId: string;
}) {
  const router = useRouter();

  const { joinRoom, leaveRoom, peerStatus } = useConnection();
  const camera = useCamera();
  const microphone = useMicrophone();
  const peers = usePeers();

  // Reactive store selectors (single source of call state, no useState).
  const callPhase = useVideoRoomStore((s) => s.callPhase);
  const connectionStatus = useVideoRoomStore((s) => s.connectionState.status);
  const isMicOn = useVideoRoomStore((s) => s.isMicOn);
  const isCameraOn = useVideoRoomStore((s) => s.isCameraOn);
  const participants = useVideoRoomStore((s) => s.participants);
  const errorMsg = useVideoRoomStore((s) => s.error);
  const getStore = useVideoRoomStore.getState;

  // Read imperatively, never as a reactive subscription: this flag is SET by
  // the join effect below, so subscribing to it made the effect depend on its
  // own write. See the dependency-array comment on that effect.
  const setInitStarted = useCallUIStore((s) => s.setInitStarted);

  // Stable refs for SDK fns (identity not guaranteed stable across renders).
  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;
  const leaveRoomRef = useRef(leaveRoom);
  leaveRoomRef.current = leaveRoom;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const micRef = useRef(microphone);
  micRef.current = microphone;

  // ── JOIN: fetch peer token (SAME edge fn as native) → joinRoom → start media ──
  useEffect(() => {
    if (!roomId || useCallUIStore.getState().initStarted) return;
    setInitStarted(true);

    let cancelled = false;

    (async () => {
      const s = getStore();
      s.clearError();
      // Was hardcoded to "video", so an audio call from chat still opened the
      // camera UI. The chat screen has always passed `callType` in the query.
      s.setCallType(callType);
      // Role and group-ness drive who may end the call: a web callee used to
      // stay on the store's "caller" default, so their hang-up would have
      // stamped 'ended' on every signal, the same teardown bug native had.
      s.setCallRole(isOutgoing ? "caller" : "callee");
      s.setCallDirection(isOutgoing ? "outgoing" : "incoming");
      s.setIsGroupCall(isGroup);
      s.setRoomId(roomId);

      // 1) Resolve the Fishjam peer token through the PERSONAL CALLS stack
      //    (`call_create` / `call_join`), the same one the native hook uses.
      //
      //    This used to call videoApi.joinRoom → `video_join_room`, which is
      //    the Sneaky Lynk room path: it looks a room up by `uuid` in
      //    video_rooms and 404s when there isn't one. A personal call never has
      //    such a row, chat mints `call-${Date.now()}` and navigates straight
      //    here, so every outgoing web call died at "connecting". WS-1 split
      //    Calls from Lynk precisely so this could not happen; native migrated,
      //    web did not.
      //
      //    Outgoing: create the room first (the caller owns it), then join the
      //    id the server gives back. Incoming: the id in the URL is already a
      //    real call room, so just join it.
      s.setCallPhase("joining_room");

      let joinTargetId = roomId;
      if (isOutgoing && participantIds.length > 0) {
        const created = await callRoomsApi.createCall({
          title: recipientUsername || "Call",
          participantIds,
          hasVideo: callType === "video",
          chatId: chatId || undefined,
        });
        if (cancelled) return;
        if (!created.ok || !created.data?.room?.id) {
          s.setError(
            created.error?.message || "Couldn't start the call",
            created.error?.code || "call_create_failed",
          );
          return;
        }
        joinTargetId = created.data.room.id;
        s.setRoomId(joinTargetId);

        // Ring the callees. Creating the room does NOT notify anyone, the
        // callee's device only rings on a `call_signals` INSERT, and the web
        // never wrote one. `sendCallSignal` had exactly one caller in the
        // codebase, the native hook, so calls out of the browser opened a room,
        // joined it, and sat there alone while the other end stayed silent.
        // Native treats this as non-fatal and so do we: the room is already
        // live, and the callee can still be reached by other means.
        try {
          // Read at send time, not captured: the auth store rehydrates on the
          // same tick this screen mounts, so a captured `user` can still be
          // null here and would ring the callee from nobody.
          const caller = useAuthStore.getState().user;
          await callSignalsApi.sendCallSignal({
            roomId: joinTargetId,
            callerId: String(caller?.id ?? ""),
            calleeIds: participantIds,
            callerUsername: caller?.username || undefined,
            callerAvatar: caller?.avatar || undefined,
            isGroup: participantIds.length > 1,
            callType,
          });
        } catch (signalErr) {
          console.warn("[call.web] Failed to ring callees:", signalErr);
        }
      }

      const joinResult = await callRoomsApi.joinCall(joinTargetId);
      if (cancelled) return;

      if (!joinResult.ok || !joinResult.data) {
        const msg = joinResult.error?.message || "Failed to join room";
        s.setError(msg, joinResult.error?.code || "join_room_failed");
        return;
      }

      const { token, user: joinedUser } = joinResult.data;
      if (!token) {
        s.setError("No peer token received", "no_peer_token");
        return;
      }

      // 2) Connect Fishjam WebRTC peer with the token + metadata.
      s.setCallPhase("connecting_peer");
      try {
        await joinRoomRef.current({
          peerToken: token,
          peerMetadata: {
            userId: joinedUser.id,
            username: joinedUser.username,
            avatar: joinedUser.avatar,
          },
        });
      } catch (peerErr: any) {
        if (cancelled) return;
        s.setError(
          peerErr?.message || "WebRTC connection failed",
          "peer_join_failed",
        );
        return;
      }
      if (cancelled) return;

      // 3) Start media: mic + camera (toggle*, which BOTH starts AND publishes
      //    the track once the peer is connected, which matches native).
      s.setCallPhase("starting_media");
      try {
        if (!micRef.current.isMicrophoneOn) {
          await micRef.current.toggleMicrophone();
        }
        s.setMicOn(true);
      } catch {
        s.setError("Microphone failed to start", "mic_start_failed");
      }
      try {
        if (!cameraRef.current.isCameraOn) {
          await cameraRef.current.toggleCamera();
        }
        s.setCameraOn(true);
      } catch {
        // Camera failure is non-fatal, call can continue audio-only.
      }
      if (cancelled) return;
      s.setCallPhase("connected");
    })();

    return () => {
      cancelled = true;
    };
  // ONLY roomId. This effect writes `initStarted`, so listing that flag (or
  // anything else that changes as a result of joining) made React tear the
  // effect down mid-flight: setInitStarted(true) changed a dependency, so the
  // cleanup ran and set `cancelled = true`, the re-run hit the initStarted
  // early-return, and the in-flight join resolved into `if (cancelled) return`,
  // silently, with no error and no log. The call sat on "Connecting…"
  // forever at phase `joining_room` and never reached `connecting_peer`.
  // Everything else here is read once at join time, so capturing it is correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── Sync Fishjam peerStatus → store connectionState ───────────────────────
  useEffect(() => {
    const s = getStore();
    if (s.callPhase === "call_ended" || s.callPhase === "error") return;
    if (peerStatus === "connected") {
      s.setConnectionStatus("connected");
    } else if (peerStatus === "connecting") {
      s.setConnectionStatus("connecting");
    } else if (peerStatus === "error") {
      s.setConnectionStatus("error", "Peer connection failed");
    }
  }, [peerStatus, getStore]);

  // ── Auto-rejoin: a bumped caller gets back in without pressing anything ───
  // peerStatus "error" while the call was connected means OUR peer dropped, and
  // everyone else keeps talking. Re-admit (call_join handles an active
  // reconnect without consuming a seat) then re-publish media. Bounded to
  // three tries with 1s/2s/4s backoff; intentional leave cancels everything.
  // The whole backoff sequence lives in one cancelled-flag async run because
  // peerStatus stays "error" between attempts, the effect cannot be its own
  // retry trigger.
  useEffect(() => {
    if (peerStatus === "connected") return;
    if (peerStatus !== "error") return;
    const s = getStore();
    if (s.callPhase !== "connected") return;
    if (intentionalLeaveRef.current || rejoinAttemptRef.current > 0) return;
    rejoinAttemptRef.current = 1;

    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        const st = getStore();
        const targetRoomId = st.roomId;
        if (
          cancelled ||
          intentionalLeaveRef.current ||
          !targetRoomId ||
          st.callPhase !== "connected"
        ) {
          return;
        }
        st.setConnectionStatus("connecting");
        try {
          const joinResult = await callRoomsApi.joinCall(targetRoomId);
          const token = joinResult.ok ? joinResult.data?.token : null;
          const joinedUser = joinResult.data?.user;
          if (!token || !joinedUser) {
            throw new Error(joinResult.error?.message || "rejoin refused");
          }
          await joinRoomRef.current({
            peerToken: token,
            peerMetadata: {
              userId: joinedUser.id,
              username: joinedUser.username,
              avatar: joinedUser.avatar,
            },
          });
          // Re-publish what was on. Guarded the same way the first join is:
          // toggle* is a true toggle, so only start what is actually off.
          if (!micRef.current.isMicrophoneOn) {
            await micRef.current.toggleMicrophone();
          }
          if (!cameraRef.current.isCameraOn) {
            await cameraRef.current.toggleCamera();
          }
          st.setConnectionStatus("connected");
          rejoinAttemptRef.current = 0;
          return;
        } catch (rejoinErr) {
          console.warn(
            `[call.web] auto-rejoin attempt ${attempt + 1} failed:`,
            rejoinErr,
          );
        }
      }
      if (!cancelled && !intentionalLeaveRef.current) {
        getStore().setError(
          "Connection lost, could not rejoin the call",
          "rejoin_failed",
        );
      }
    })();

    return () => {
      cancelled = true;
      rejoinAttemptRef.current = 0;
    };
  }, [peerStatus, getStore]);

  // ── Sync local camera stream → store ──────────────────────────────────────
  useEffect(() => {
    const stream = camera.cameraStream ?? null;
    const s = getStore();
    s.setLocalStream(stream as any);
    s.setCameraOn(!!stream && stream.getVideoTracks().length > 0);
  }, [camera.cameraStream, getStore]);

  // ── Sync remote peers → store participants (web PeerWithTracks) ────────────
  useEffect(() => {
    const remotePeers = peers.remotePeers || [];
    const next: Participant[] = remotePeers.map((peer) => {
      const meta = (peer.metadata?.peer ?? peer.metadata) as any;
      const cam = peer.cameraTrack;
      const mic = peer.microphoneTrack;
      return {
        odId: peer.id,
        oderId: meta?.userId ?? peer.id,
        userId: meta?.userId ?? peer.id,
        username: meta?.username ?? "?",
        avatar: meta?.avatar,
        role: meta?.role || "participant",
        isLocal: false,
        isCameraOn: !!(cam?.stream || cam?.track || cam?.trackId),
        isMicOn: !!(mic?.stream || mic?.track || mic?.trackId),
        isScreenSharing: false,
        videoTrack: cam ?? null,
        audioTrack: mic ?? null,
      };
    });
    getStore().setParticipants(next);
  }, [peers.remotePeers, getStore]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    void (async () => {
      await micRef.current.toggleMicrophone();
      getStore().setMicOn(micRef.current.isMicrophoneOn);
    })();
  }, [getStore]);

  const toggleCamera = useCallback(() => {
    void (async () => {
      await cameraRef.current.toggleCamera();
      getStore().setCameraOn(cameraRef.current.isCameraOn);
    })();
  }, [getStore]);

  // Web "switch camera" = cycle to the next available camera device.
  const switchCamera = useCallback(() => {
    void (async () => {
      const devices = cameraRef.current.cameraDevices || [];
      if (devices.length < 2) return;
      const current = cameraRef.current.currentCamera?.deviceId;
      const idx = devices.findIndex((d) => d.deviceId === current);
      const nextDevice = devices[(idx + 1) % devices.length];
      if (nextDevice) await cameraRef.current.selectCamera(nextDevice.deviceId);
    })();
  }, []);

  // Set before any teardown so the rejoin effect knows a disconnect after
  // this point is the user's own choice, not a bump to recover from.
  const intentionalLeaveRef = useRef(false);
  // >0 while a rejoin sequence is in flight, guards against re-entry.
  const rejoinAttemptRef = useRef(0);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    const s = getStore();
    const duration = s.callDuration;
    const roomIdToLeave = s.roomId;
    try {
      leaveRoomRef.current();
    } catch {
      // ignore, leaving a dead room is non-fatal
    }
    try {
      cameraRef.current.stopCamera();
      micRef.current.stopMicrophone();
    } catch {
      // ignore
    }
    if (roomIdToLeave) {
      // Free my seat, without this the room accumulates 'active' ghosts and
      // hits call_full. Non-fatal: a stuck seat is bad, a stuck leave is
      // survivable.
      callRoomsApi.leaveCall(roomIdToLeave).catch(() => {});
      // Only the caller ends a group call; anyone ends a 1:1. A member's
      // hang-up used to stamp 'ended' on every signal (native side), kicking
      // the rest of the room, same rule here so a web member doesn't.
      if (!s.isGroupCall || s.callRole === "caller") {
        callSignalsApi.endCallSignals(roomIdToLeave).catch(() => {});
      }
    }
    s.setCallEnded(duration);
    router.back();
  }, [getStore, router]);

  // ── Remote hangup: the OTHER side left, so this screen must go too ────────
  // Only the person who pressed the button ran `leave()`; the remote party was
  // left sitting on a live-looking call screen until they navigated away by
  // hand. On a group call a single member's declined/missed is NOT the room
  // ending. It used to be, which is how one person saying no hung up on three
  // people. Only "ended" (caller out / room closed) is terminal there.
  //
  // Subscribed on the STORE roomId, not the route param: an outgoing call
  // arrives with a placeholder `call-<ts>` id and the real room uuid only
  // exists after call_create returns. Signals are written against the uuid,
  // so a prop-keyed subscription could never fire for the caller.
  const liveRoomId = useVideoRoomStore((s) => s.roomId);
  useEffect(() => {
    if (!liveRoomId || liveRoomId.startsWith("call-")) return;
    return callSignalsApi.subscribeToRoomEnded(liveRoomId, (signal) => {
      const s = getStore();
      if (s.isGroupCall && signal.status !== "ended") return;
      if (s.callPhase === "call_ended" || s.callPhase === "error") return;
      leave();
    });
  }, [liveRoomId, getStore, leave]);

  // ── Room closed without a signal ──────────────────────────────────────────
  // endCallSignals only fires on explicit hangs. A server-side end (the room
  // sweep, last-member-out, or video_end_room) leaves status='ended' on the
  // video_rooms row with no signal at all, and the screen used to sit on
  // "Waiting for others…" forever. Watch the room row itself.
  useEffect(() => {
    if (!liveRoomId || liveRoomId.startsWith("call-")) return;
    const channel = freshChannel(`call_room_row:${liveRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_rooms",
          filter: `uuid=eq.${liveRoomId}`,
        },
        (payload) => {
          const status = (payload.new as { status?: string })?.status;
          if (status === "open") return;
          const s = getStore();
          if (s.callPhase === "call_ended" || s.callPhase === "error") return;
          leave();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [liveRoomId, getStore, leave]);

  // ── Last one on the call ──────────────────────────────────────────────────
  // The last remote leaving used to strand the screen on "Waiting for
  // others…" indefinitely, same on 1:1 when the other side drops without a
  // signal (crash, closed tab). Once at least one remote has joined and the
  // room drops back to zero, count down a grace window: a rejoin cancels it,
  // the Stay button cancels it, and zero ends the call the same way End call
  // does. A call still ringing its first invitees is untouched, the clock
  // only arms after someone was actually on.
  const ALONE_GRACE_SECONDS = 60;
  const hadRemoteRef = useRef(false);
  const aloneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [aloneSecondsLeft, setAloneSecondsLeft] = useState<number | null>(null);
  const cancelAloneTimer = useCallback(() => {
    if (aloneTimerRef.current) clearInterval(aloneTimerRef.current);
    aloneTimerRef.current = null;
    setAloneSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (callPhase !== "connected") return;

    if (participants.length > 0) {
      hadRemoteRef.current = true;
      cancelAloneTimer();
      return;
    }

    if (!hadRemoteRef.current || aloneTimerRef.current) return;

    const deadline = Date.now() + ALONE_GRACE_SECONDS * 1000;
    setAloneSecondsLeft(ALONE_GRACE_SECONDS);
    aloneTimerRef.current = setInterval(() => {
      const left = Math.ceil((deadline - Date.now()) / 1000);
      if (left <= 0) {
        if (aloneTimerRef.current) clearInterval(aloneTimerRef.current);
        aloneTimerRef.current = null;
        setAloneSecondsLeft(null);
        leave();
      } else {
        setAloneSecondsLeft(left);
      }
    }, 1000);
  }, [callPhase, participants.length, cancelAloneTimer, leave]);

  // Leave Fishjam on unmount (mirrors native cleanup effect).
  useEffect(() => {
    return () => {
      if (aloneTimerRef.current) clearInterval(aloneTimerRef.current);
      try {
        leaveRoomRef.current();
      } catch {
        // ignore
      }
      getStore().reset();
      useCallUIStore.getState().setInitStarted(false);
    };
  }, [getStore]);

  const localStream = camera.cameraStream;
  const remoteName =
    participants[0]?.username || recipientUsername || "Connecting…";

  const connecting =
    callPhase === "joining_room" ||
    callPhase === "connecting_peer" ||
    callPhase === "starting_media";

  // The top bar names the state; the card below the grid carries the countdown
  // and the way out of it. Both used to render `statusLabel`, so the seconds
  // ticked in two places and said it twice.
  const statusLabel =
    callPhase === "error"
      ? errorMsg || "Call failed"
      : aloneSecondsLeft !== null
        ? "Everyone left"
        : participants.length > 1
          ? `Group call · ${participants.length + 1}`
          : participants.length === 1
            ? remoteName
            : connecting
              ? "Connecting…"
              : "Waiting for others";

  // ── Group grid: viewport, paging, geometry ────────────────────────────────
  // Twelve faces at once is a wall of thumbnails nobody can read, so the grid
  // pages. Every number below comes out of `group-call-layout.ts`, which is unit
  // tested; this block only measures the window and reads the answers.
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  const [participantPage, setParticipantPage] = useState(0);

  useEffect(() => {
    const measure = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const gridLayout = useMemo(
    () => getGroupCallLayout(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );

  const groupTiles = useMemo(
    () =>
      orderGroupCallTiles<CallTile>(
        {
          id: "local",
          name: "You",
          avatar: undefined,
          isLocal: true,
          isMicOn,
          hasVideo: isCameraOn && !!localStream,
          stream: localStream,
        },
        participants.map((participant) => ({
          id: participant.odId || participant.userId,
          name:
            participant.displayName ||
            participant.username ||
            participant.anonLabel ||
            "Guest",
          avatar: participant.avatar,
          isLocal: false,
          isMicOn: participant.isMicOn,
          hasVideo:
            participant.isCameraOn && !!(participant.videoTrack as any)?.stream,
          stream: ((participant.videoTrack as any)?.stream ??
            null) as MediaStream | null,
        })),
      ),
    [isCameraOn, isMicOn, localStream, participants],
  );

  const participantPageModel = useMemo(
    () =>
      getGroupCallPage(
        groupTiles,
        participantPage,
        gridLayout.pageSize,
        gridLayout,
      ),
    [gridLayout, groupTiles, participantPage],
  );

  // A page that empties out, because everyone on page two hung up, has to pull
  // the viewer back; otherwise the grid renders nothing and the only way off a
  // page that no longer exists is the disabled arrow.
  useEffect(() => {
    if (participantPage !== participantPageModel.page) {
      setParticipantPage(participantPageModel.page);
    }
  }, [participantPage, participantPageModel.page]);

  const moveParticipantPage = useCallback(
    (delta: -1 | 1) => {
      setParticipantPage((current) =>
        moveGroupCallPage(current, delta, participantPageModel.pageCount),
      );
    },
    [participantPageModel.pageCount],
  );

  const hasPager = participantPageModel.pageCount > 1;
  const pagerReservePx = hasPager
    ? PAGER_STRIP_PX + GRID_GAP_PX * 2
    : GRID_GAP_PX;

  // A mouse has an arrow to click and a thumb has a swipe; a keyboard has
  // neither, and the dots are not focusable, so without this the second page is
  // unreachable. Bound to the grid wrapper rather than `window`: a global
  // listener would swallow arrow keys from every other field on the page.
  const onGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const delta =
        event.key === "ArrowRight" || event.key === "PageDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "PageUp"
            ? -1
            : 0;
      if (delta === 0) return;
      // Only the four keys handled here, so Tab still escapes to the controls.
      event.preventDefault();
      moveParticipantPage(delta as -1 | 1);
    },
    [moveParticipantPage],
  );

  // ── Who is talking, including on a page you cannot see ────────────────────
  // Pagination buys legibility and spends awareness: the person speaking can sit
  // on a page nobody is looking at, and the call goes quiet-looking for no
  // reason. `useVAD` is the same Fishjam web SDK this file already imports, and
  // `odId` is the Fishjam peer id (see the peers sync effect above), so the tile
  // ids are valid peer ids as they stand. Only remote ids go in: "local" is a
  // synthetic id this file mints and Fishjam has never heard of it.
  const remotePeerIds = useMemo(
    () => groupTiles.filter((tile) => !tile.isLocal).map((tile) => tile.id),
    [groupTiles],
  );
  // `PeerId` is a branded string, so the cast goes through `unknown`. The values
  // themselves are already peer ids: the effect above assigns `odId: peer.id`.
  const vad = useVAD({
    peerIds: remotePeerIds as unknown as readonly PeerId[],
  }) as Record<string, boolean> | undefined;
  // Filtered against the live peer list so a speaker who leaves mid-word cannot
  // leave a ring behind on a recycled tile.
  const speakingIds = useMemo(
    () => remotePeerIds.filter((id) => vad?.[id] === true),
    [remotePeerIds, vad],
  );
  const speakingSet = useMemo(() => new Set(speakingIds), [speakingIds]);
  const tileIds = useMemo(() => groupTiles.map((tile) => tile.id), [groupTiles]);
  const speakingPage = findSpeakingPage(
    tileIds,
    speakingIds,
    participantPageModel.pageSize,
    participantPageModel.page,
  );
  const pagesWithSpeakers = useMemo(() => {
    const pages = new Set<number>();
    tileIds.forEach((id, index) => {
      if (speakingSet.has(id)) {
        pages.add(Math.floor(index / participantPageModel.pageSize));
      }
    });
    return pages;
  }, [participantPageModel.pageSize, speakingSet, tileIds]);

  // ── Adaptive stage: solo / duo / grid ─────────────────────────────────────
  // FaceTime and WhatsApp both drop the grid entirely at low headcount: alone,
  // your own camera fills the stage; one remote, the remote fills the stage and
  // your camera is a floating PiP. A four-column grid with one face in a cell
  // reads as empty, not as a call. Three or more remotes keep the paged grid.
  const remoteTiles = groupTiles.filter((tile) => !tile.isLocal);
  const localTile = groupTiles[0];
  const stageMode =
    remoteTiles.length === 0 ? "solo" : remoteTiles.length === 1 ? "duo" : "grid";
  const offPageSpeakerNames = groupTiles
    .filter(
      (tile, index) =>
        speakingSet.has(tile.id) &&
        Math.floor(index / participantPageModel.pageSize) !==
          participantPageModel.page,
    )
    .map((tile) => tile.name);
  const speakerChipLabel =
    offPageSpeakerNames.length === 1
      ? `${offPageSpeakerNames[0]} is speaking`
      : `${offPageSpeakerNames.length} people speaking`;

  // Armed after 400ms of continuous off-page speech so a one-word "yeah" does
  // not flash a chip, and disarmed the instant the speech stops. The dot tint is
  // deliberately not debounced: it is a colour, not a thing that appears.
  const [speakerChipArmed, setSpeakerChipArmed] = useState(false);
  useEffect(() => {
    if (speakingPage === null) {
      setSpeakerChipArmed(false);
      return;
    }
    const timer = setTimeout(() => setSpeakerChipArmed(true), 400);
    return () => clearTimeout(timer);
  }, [speakingPage]);
  const showSpeakerChip =
    speakerChipArmed && speakingPage !== null && offPageSpeakerNames.length > 0;

  // Announced at three marks only. A live region that re-reads every second is
  // unusable, and the visible number is already there to be re-read on demand.
  const countdownAnnouncement =
    aloneSecondsLeft === 30 || aloneSecondsLeft === 10 || aloneSecondsLeft === 5
      ? `Ending the call in ${aloneSecondsLeft}s.`
      : "";

  // One tile face in three sizes. "cell" is a grid member with the 16:9 cap;
  // "fill" owns the whole stage (solo preview, duo remote); "pip" is the small
  // floating self-view on a duo call — no name pill, since a PiP is always you
  // and the pill would cover half the tile.
  const renderTile = (tile: CallTile, mode: "cell" | "fill" | "pip") => {
    const isSpeaking = speakingSet.has(tile.id);
    // Five separate labels per face is five stops to walk past on a
    // twelve-person call, so the badges stay visual and the container says the
    // whole thing in one phrase.
    const tileLabel = [
      tile.isLocal ? "You" : tile.name,
      tile.isMicOn ? null : "muted",
      tile.hasVideo ? null : "camera off",
      isSpeaking ? "speaking" : null,
    ]
      .filter(Boolean)
      .join(", ");

    return (
      <div
        key={tile.id}
        role="img"
        aria-label={tileLabel}
        className={`relative min-h-0 min-w-0 overflow-hidden border border-white/15 bg-[#15171c] ${
          mode === "pip" ? "h-full w-full rounded-xl shadow-2xl" : "h-full rounded-2xl"
        }`}
        style={{
          ...(mode === "cell"
            ? {
                // The 16:9 cap, in CSS rather than JS. The browser already
                // sized the 1fr cell; a tile wider than that is a letterbox
                // slit with a face in it, so the aspect ratio caps the width
                // and `place-items-center` centres what is left of the track.
                width: "auto",
                maxWidth: "100%",
                aspectRatio: "16 / 9",
              }
            : { width: "100%" }),
          // A ring, never a resize. Growing the speaker's tile relays out every
          // other video on the page and moves the face you were already looking
          // at. Inset so the 2px sits over the video instead of pushing the grid.
          boxShadow: isSpeaking ? `inset 0 0 0 2px ${CALL_ACCENT}` : undefined,
        }}
      >
        {tile.hasVideo && tile.stream ? (
          <VideoTile
            stream={tile.stream}
            muted={tile.isLocal}
            mirror={tile.isLocal}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#15171c]">
            <AvatarFallback name={tile.name} avatar={tile.avatar} />
          </div>
        )}

        {/* Camera off reads once, in the corner. */}
        {!tile.hasVideo && mode !== "pip" && (
          <span
            className="absolute left-2 top-2 flex h-6 items-center rounded-lg border border-white/15 bg-[rgba(4,8,16,0.72)] px-2"
            style={{ color: color.textDim }}
          >
            <VideoOff size={11} />
          </span>
        )}

        {/* Solid scrim, no blur. A blurred white video frame is still white, so
            blur buys no contrast floor; rgba(0,0,0,0.70) under white text
            measures 9.2:1 over the worst case. The right inset reserves the
            mute chip's 26px whether or not the chip is there, so the pill does
            not resize mid-sentence when someone toggles their mic. */}
        {mode !== "pip" && (
          <div className="absolute bottom-2 left-2 right-10 flex min-h-[28px] min-w-0 items-center rounded-xl bg-black/70 px-[9px]">
            <span className="min-w-0 truncate text-[13px] font-bold text-white">
              {tile.isLocal ? "You" : tile.name}
            </span>
          </div>
        )}

        {/* White glyph on a dark scrim, red as a border. White text on a
            #FC253A fill measures 3.84:1 and fails AA at this size, which is why
            the red carries no text at all. */}
        {!tile.isMicOn && (
          <span
            className="absolute bottom-[9px] right-[9px] flex h-[26px] w-[26px] items-center justify-center rounded-[9px] border bg-[rgba(4,8,16,0.72)] text-white"
            style={{ borderColor: "rgba(252,37,58,0.55)" }}
          >
            <MicOff size={12} />
          </span>
        )}
      </div>
    );
  };

  return (
    // FIXED and above the app chrome. Two things were covering the controls:
    //   1. `h-screen` is 100vh = the LARGE viewport (mobile toolbars retracted),
    //      and with `overflow-hidden` the bar under the browser toolbar was not
    //      just hidden but unreachable, you could not scroll to End Call.
    //   2. The app's own tab bar is `position: fixed; z-index: 1000`, so it
    //      painted over the mic/camera/hang-up row.
    // Padding around the tab bar would be the wrong fix: an active call is a
    // takeover surface, and offering Home/Events/Profile mid-call invites you to
    // navigate out of the call you are on. z-2000 sits above the tab bar and
    // below the incoming-call overlay (3000), which must still interrupt.
    <main className="fixed inset-x-0 top-0 z-[2000] flex h-[100dvh] w-full flex-col overflow-hidden bg-[#06070d]">
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          paddingTop: `${TOP_BAND_PX}px`,
          paddingLeft: `${GRID_PAD_X_PX}px`,
          paddingRight: `${GRID_PAD_X_PX}px`,
          paddingBottom: `calc(${CONTROLS_BAND} + ${pagerReservePx}px)`,
        }}
      >
        {/* The wrapper, not the arrows, owns paging keys: it is the thing that
            holds the pages, and a listener on either arrow would stop working
            the moment that arrow went disabled at the end of the range. It is a
            focus stop only while there is somewhere to page to. */}
        {stageMode === "grid" ? (
          // The wrapper, not the arrows, owns paging keys: it is the thing that
          // holds the pages, and a listener on either arrow would stop working
          // the moment that arrow went disabled at the end of the range. It is a
          // focus stop only while there is somewhere to page to.
          <div
            role="group"
            tabIndex={hasPager ? 0 : -1}
            aria-label="Call participants"
            aria-roledescription="participant pages"
            onKeyDown={onGridKeyDown}
            className={`grid h-full w-full place-items-center gap-2 rounded-2xl ${FOCUS_RING}`}
            style={{
              gridTemplateColumns: `repeat(${gridLayout.columns}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridLayout.rows}, minmax(0, 1fr))`,
            }}
          >
            {participantPageModel.visibleTiles.map((tile) =>
              renderTile(tile, "cell"),
            )}
          </div>
        ) : (
          // Solo: your own camera fills the stage while the room waits (FaceTime
          // ringing preview). Duo: the remote fills the stage and your camera is
          // a floating PiP top-right, clear of the name pill and mute chip.
          <div
            role="group"
            aria-label="Call participants"
            className="relative h-full w-full"
          >
            {stageMode === "duo" ? renderTile(remoteTiles[0], "fill") : null}
            {stageMode === "duo" ? (
              <div className="absolute right-3 top-3 aspect-[3/4] w-[clamp(96px,26vw,190px)]">
                {renderTile(localTile, "pip")}
              </div>
            ) : (
              renderTile(localTile, "fill")
            )}
          </div>
        )}

        {hasPager && (
          <nav
            aria-label="Participant pages"
            className="absolute inset-x-0 flex flex-col items-center gap-2"
            style={{ bottom: `calc(${CONTROLS_BAND} + ${GRID_GAP_PX}px)` }}
          >
            {/* The whole point of the feature: say who is talking off-page and
                offer the one tap that gets you there. */}
            {showSpeakerChip && speakingPage !== null && (
              <button
                type="button"
                onClick={() => setParticipantPage(speakingPage)}
                aria-label={`${speakerChipLabel}, go to page ${speakingPage + 1}`}
                className={`flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-[rgba(8,10,18,0.72)] px-3 text-[13px] font-medium text-white ${FOCUS_RING}`}
              >
                <Volume2 size={14} style={{ color: CALL_ACCENT }} />
                {speakerChipLabel}
              </button>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => moveParticipantPage(-1)}
                disabled={participantPageModel.page === 0}
                aria-label="Previous page"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/70 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/40 ${FOCUS_RING}`}
              >
                <ChevronLeft size={20} />
              </button>

              {/* Decoration, and marked as such. These were `<button
                  tabIndex={-1}>` in an `aria-hidden` container with an 8px hit
                  box: clickable by mouse, invisible to a keyboard and a screen
                  reader. Paging belongs to the 44px arrows and the arrow keys on
                  both platforms, so the dots only report position. An accent
                  tint on an inactive dot means someone is talking there. */}
              <span className="flex items-center gap-2" aria-hidden="true">
                {Array.from(
                  { length: participantPageModel.pageCount },
                  (_, index) => {
                    const isCurrent = index === participantPageModel.page;
                    const hasSpeaker =
                      !isCurrent && pagesWithSpeakers.has(index);
                    return (
                      <span
                        key={index}
                        className={`h-[7px] rounded-full transition-[width,background-color] motion-reduce:transition-none ${
                          isCurrent ? "w-5" : "w-[7px]"
                        }`}
                        style={{
                          backgroundColor: isCurrent
                            ? CALL_ACCENT
                            : hasSpeaker
                              ? "rgba(142,219,255,0.55)"
                              : "rgba(255,255,255,0.28)",
                        }}
                      />
                    );
                  },
                )}
              </span>

              <button
                type="button"
                onClick={() => moveParticipantPage(1)}
                disabled={
                  participantPageModel.page ===
                  participantPageModel.pageCount - 1
                }
                aria-label="Next page"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/70 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/40 ${FOCUS_RING}`}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </nav>
        )}

        <p aria-live="polite" className="sr-only">
          Participant page {participantPageModel.page + 1} of{" "}
          {participantPageModel.pageCount},{" "}
          {participantPageModel.visibleTiles.length} people
        </p>

        {/* The local tile stays in the grid behind this card. An empty stage
            with a message on it reads as a broken call. */}
        {participants.length === 0 && !connecting && callPhase !== "error" && (
          <div
            className="absolute inset-x-6 rounded-2xl border p-4 text-center text-white"
            style={{
              bottom: `calc(${CONTROLS_BAND} + ${pagerReservePx + 16}px)`,
              backgroundColor: "rgba(8,10,18,0.92)",
              borderColor:
                aloneSecondsLeft !== null
                  ? `${color.signal}66`
                  : "rgba(255,255,255,0.10)",
            }}
          >
            <p className="text-[17px] font-semibold">
              {aloneSecondsLeft !== null
                ? "Everyone left"
                : "Waiting for others"}
            </p>
            <p
              className="mt-1 text-[13px]"
              // Tabular figures so the card does not reflow once a second.
              style={{
                color: color.textDim,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {aloneSecondsLeft !== null
                ? `Ending the call in ${aloneSecondsLeft}s.`
                : "Your room stays open until someone joins."}
            </p>
            {aloneSecondsLeft !== null && (
              <button
                type="button"
                onClick={cancelAloneTimer}
                className={`mt-3 min-h-11 rounded-xl border px-4 text-[13px] font-bold text-white ${FOCUS_RING}`}
                style={{
                  backgroundColor: "rgba(142,219,255,0.22)",
                  borderColor: "rgba(142,219,255,0.48)",
                }}
              >
                Stay on call
              </button>
            )}
            <p aria-live="polite" className="sr-only">
              {countdownAnnouncement}
            </p>
          </div>
        )}

        {/* Hidden audio sinks: EVERY remote participant, not the visible tiles.
            Pagination hides video and must never mute anyone, and mapping
            `participantPageModel.visibleTiles` here instead of `participants` is
            exactly how that would break: page two would go silent. */}
        {participants.map((p) => {
          const aStream: MediaStream | null =
            (p.audioTrack as any)?.stream ?? null;
          if (!aStream) return null;
          return (
            <VideoTile
              key={`audio-${p.odId}`}
              stream={aStream}
              muted={false}
              className="hidden"
            />
          );
        })}
      </div>

      {/* Top status bar */}
      <header
        className="relative z-10 flex items-center justify-between px-5"
        style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.5rem))" }}
      >
        <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                connectionStatus === "connected"
                  ? ACCENT
                  : callPhase === "error"
                    ? color.signal
                    : color.gold,
            }}
          />
          <span
            className="text-sm text-white"
            style={{ fontFamily: "Inter-SemiBold" }}
          >
            {statusLabel}
          </span>
        </div>
      </header>

      {/* Controls bar: circular icon buttons */}
      <footer
        className="relative z-10 mt-auto flex items-center justify-center gap-5"
        // Same constant the pager and the grid's bottom reserve are built from,
        // so the three cannot drift apart.
        style={{ paddingBottom: CONTROLS_SAFE_PAD }}
      >
        <ControlButton
          onClick={toggleMic}
          active={isMicOn}
          label={isMicOn ? "Mute microphone" : "Unmute microphone"}
        >
          {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
        </ControlButton>

        <ControlButton
          onClick={toggleCamera}
          active={isCameraOn}
          label={isCameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {isCameraOn ? <Video size={24} /> : <VideoOff size={24} />}
        </ControlButton>

        <ControlButton onClick={switchCamera} active label="Switch camera">
          <SwitchCamera size={24} />
        </ControlButton>

        <ControlButton onClick={leave} danger label="End call">
          <PhoneOff size={24} />
        </ControlButton>
      </footer>
    </main>
  );
}

// ── Public screen: wraps the room in FishjamProvider (web RTC context) ────────
export function CallScreen() {
  const params = useParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomId = String((params as any)?.roomId ?? "");

  // The chat screen puts the call's intent in the query string
  // (`?isOutgoing=true&callType=video&participantIds=…`). This screen used to
  // read only the path param and always join, which is why an outgoing call
  // never created a room.
  const search = useSearchParams();
  const isOutgoing = search?.get("isOutgoing") === "true";
  const participantIds = (search?.get("participantIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const callType = search?.get("callType") === "audio" ? "audio" : "video";
  const recipientUsername = search?.get("recipientUsername") ?? "";
  // Explicit flag from the caller's query, or inferred: a call with more than
  // one callee is a group call either way.
  const isGroup =
    search?.get("isGroup") === "true" || participantIds.length > 1;
  // The group chat the call was started from. It lands on video_rooms so the
  // chat header can offer Join/Rejoin while the room is open.
  const chatId = search?.get("chatId") ?? "";

  return (
    <FishjamProvider fishjamId={resolveFishjamAppId()}>
      <CallRoom
        roomId={roomId}
        isOutgoing={isOutgoing}
        participantIds={participantIds}
        callType={callType}
        recipientUsername={recipientUsername}
        isGroup={isGroup}
        chatId={chatId}
      />
    </FishjamProvider>
  );
}

export default CallScreen;
