"use client";

/**
 * Call Room — WEB port of the native RTC screen
 * (`/deviant/app/(protected)/call/[roomId].tsx` + `useVideoCall`).
 *
 * The native path wraps `@fishjam-cloud/react-native-client` (native-only). On
 * web we use the REAL web SDK `@fishjam-cloud/react-client` — `FishjamProvider`,
 * `useConnection` (joinRoom/leaveRoom/peerStatus), `useCamera`, `useMicrophone`,
 * `usePeers`. The native `useVideoCall` hook can't be reused, so its join/leave
 * and peer→store sync logic is REPLICATED here against the web SDK.
 *
 * PORTABLE SHARED WIRING (identical to native):
 *   - Room/token: `callRoomsApi` (`call_create` / `call_join`) — the PERSONAL
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

import { useEffect, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import {
  FishjamProvider,
  useConnection,
  useCamera,
  useMicrophone,
  usePeers,
} from "@fishjam-cloud/react-client";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  SwitchCamera,
} from "lucide-react";
import { callRoomsApi } from "@dvnt/app/lib/api/call-rooms";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVideoRoomStore } from "@dvnt/app/features/video";
import type { Participant } from "@dvnt/app/features/video/types";
import { color } from "@dvnt/app/lib/theme";
import { callSignalsApi } from "@dvnt/app/lib/api/call-signals";
import { useCallUIStore } from "./call-ui-store";

const ACCENT = color.cyan;

// ── <video> tile: binds a MediaStream to a DOM video element via ref ──────────
// No useState — the stream is attached imperatively in a ref callback (the
// canonical web pattern, equivalent to native RTCView taking a stream).
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
}

// ── Avatar fallback (rounded SQUARE — never circular, per DVNT rule) ──────────
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

// ── Inner screen — rendered INSIDE FishjamProvider so SDK hooks are valid ─────
function CallRoom({
  roomId,
  isOutgoing,
  participantIds,
  callType,
  recipientUsername,
  isGroup,
}: {
  roomId: string;
  isOutgoing: boolean;
  participantIds: string[];
  callType: "audio" | "video";
  recipientUsername: string;
  isGroup: boolean;
}) {
  const router = useRouter();

  const { joinRoom, leaveRoom, peerStatus } = useConnection();
  const camera = useCamera();
  const microphone = useMicrophone();
  const peers = usePeers();

  // Reactive store selectors (single source of call state — no useState).
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
      // stamped 'ended' on every signal — the same teardown bug native had.
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
      //    such a row — chat mints `call-${Date.now()}` and navigates straight
      //    here — so every outgoing web call died at "connecting". WS-1 split
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

        // Ring the callees. Creating the room does NOT notify anyone — the
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
      //    the track once the peer is connected — matches native semantics).
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
        // Camera failure is non-fatal — call can continue audio-only.
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
  // early-return, and the in-flight join resolved into `if (cancelled) return`
  // — silently, with no error and no log. The call sat on "Connecting…"
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
  // peerStatus "error" while the call was connected means OUR peer dropped —
  // everyone else keeps talking. Re-admit (call_join handles an active
  // reconnect without consuming a seat) then re-publish media. Bounded to
  // three tries with 1s/2s/4s backoff; intentional leave cancels everything.
  // The whole backoff sequence lives in one cancelled-flag async run because
  // peerStatus stays "error" between attempts — the effect cannot be its own
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
          "Connection lost — could not rejoin the call",
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
  // >0 while a rejoin sequence is in flight — guards against re-entry.
  const rejoinAttemptRef = useRef(0);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    const s = getStore();
    const duration = s.callDuration;
    const roomIdToLeave = s.roomId;
    try {
      leaveRoomRef.current();
    } catch {
      // ignore — leaving a dead room is non-fatal
    }
    try {
      cameraRef.current.stopCamera();
      micRef.current.stopMicrophone();
    } catch {
      // ignore
    }
    if (roomIdToLeave) {
      // Free my seat — without this the room accumulates 'active' ghosts and
      // hits call_full. Non-fatal: a stuck seat is bad, a stuck leave is
      // survivable.
      callRoomsApi.leaveCall(roomIdToLeave).catch(() => {});
      // Only the caller ends a group call; anyone ends a 1:1. A member's
      // hang-up used to stamp 'ended' on every signal (native side), kicking
      // the rest of the room — same rule here so a web member doesn't.
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
  // ending — it used to be, which is how one person saying no hung up on
  // three people. Only "ended" (caller out / room closed) is terminal there.
  useEffect(() => {
    if (!roomId) return;
    return callSignalsApi.subscribeToRoomEnded(roomId, (signal) => {
      const s = getStore();
      if (s.isGroupCall && signal.status !== "ended") return;
      if (s.callPhase === "call_ended" || s.callPhase === "error") return;
      leave();
    });
  }, [roomId, getStore, leave]);

  // Leave Fishjam on unmount (mirrors native cleanup effect).
  useEffect(() => {
    return () => {
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

  const statusLabel =
    callPhase === "error"
      ? errorMsg || "Call failed"
      : participants.length > 1
        ? `Group call · ${participants.length + 1}`
        : participants.length === 1
          ? remoteName
          : connecting
            ? "Connecting…"
            : "Waiting for others…";

  // Every remote gets a tile, not just the first — the old layout rendered
  // participants[0] and left the rest as audio-only ghosts. FaceTime-style
  // density: 1 fills the screen, 2 splits (stacked on a phone), 3–4 go 2x2,
  // 5–6 go three-up on wider screens, and a full house (up to 9 remote)
  // packs three-up on phones, four-up on desktop — scrolling when rows
  // exceed the viewport instead of squashing tiles.
  const remoteCount = participants.length;
  const dense = remoteCount > 4;
  const gridClass =
    remoteCount <= 1
      ? "grid-cols-1"
      : remoteCount === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : remoteCount <= 4
          ? "grid-cols-2"
          : remoteCount <= 6
            ? "grid-cols-2 sm:grid-cols-3"
            : "grid-cols-3 sm:grid-cols-4";

  return (
    // FIXED and above the app chrome. Two things were covering the controls:
    //   1. `h-screen` is 100vh = the LARGE viewport (mobile toolbars retracted),
    //      and with `overflow-hidden` the bar under the browser toolbar was not
    //      just hidden but unreachable — you could not scroll to End Call.
    //   2. The app's own tab bar is `position: fixed; z-index: 1000`, so it
    //      painted over the mic/camera/hang-up row.
    // Padding around the tab bar would be the wrong fix: an active call is a
    // takeover surface, and offering Home/Events/Profile mid-call invites you to
    // navigate out of the call you are on. z-2000 sits above the tab bar and
    // below the incoming-call overlay (3000), which must still interrupt.
    <main className="fixed inset-x-0 top-0 z-[2000] flex h-[100dvh] w-full flex-col overflow-hidden bg-[#06070d]">
      {/* Remote participants — one tile each */}
      <div className="absolute inset-0">
        {participants.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
            <AvatarFallback name={remoteName} />
            <p
              role="status"
              aria-live="polite"
              className="text-lg text-white"
              style={{ fontFamily: "SpaceGrotesk-SemiBold" }}
            >
              {statusLabel}
            </p>
          </div>
        ) : (
          <div
            className={
              dense
                ? `grid h-full w-full content-start gap-1.5 overflow-y-auto px-1.5 pb-28 pt-20 ${gridClass}`
                : `grid h-full w-full ${gridClass}`
            }
          >
            {participants.map((p) => {
              const vStream: MediaStream | null =
                (p.videoTrack as any)?.stream ?? null;
              return (
                <div
                  key={p.odId}
                  className={`relative min-h-0 min-w-0 overflow-hidden bg-black ${
                    dense ? "aspect-video rounded-xl" : ""
                  }`}
                >
                  {vStream ? (
                    <VideoTile
                      stream={vStream}
                      muted={false}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                      <AvatarFallback name={p.username ?? "?"} avatar={p.avatar} />
                    </div>
                  )}
                  <div
                    className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 backdrop-blur"
                    aria-label={`${p.username}${p.isMicOn ? "" : ", muted"}`}
                  >
                    {!p.isMicOn && <MicOff size={12} className="text-white/70" />}
                    <span className="max-w-40 truncate text-xs text-white">
                      {p.username}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hidden audio sinks for remote participants without video on screen */}
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

      {/* Local PiP tile — rounded-2xl */}
      {localStream && isCameraOn ? (
        <div
          className="absolute right-4 z-10 h-44 w-32 overflow-hidden rounded-2xl border border-white/15 shadow-lg"
          style={{ top: "calc(env(safe-area-inset-top) + 5rem)" }}
        >
          <VideoTile
            stream={localStream}
            muted
            mirror
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      {/* Controls bar — circular icon buttons */}
      <footer
        className="relative z-10 mt-auto flex items-center justify-center gap-5"
        style={{ paddingBottom: "max(2.5rem, calc(env(safe-area-inset-bottom) + 1rem))" }}
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

  return (
    <FishjamProvider fishjamId={resolveFishjamAppId()}>
      <CallRoom
        roomId={roomId}
        isOutgoing={isOutgoing}
        participantIds={participantIds}
        callType={callType}
        recipientUsername={recipientUsername}
        isGroup={isGroup}
      />
    </FishjamProvider>
  );
}

export default CallScreen;
