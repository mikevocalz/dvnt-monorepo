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
 *   - Token/room fetch: `videoApi.joinRoom(roomId)` (Supabase edge fn
 *     `video_join_room`) → { token, user, room } — the SAME peer-token path.
 *   - `resolveFishjamAppId()` for the FishjamProvider `fishjamId`.
 *   - `useVideoRoomStore` (Zustand) is the single source of call state.
 *
 * HARD CONVENTIONS:
 *   - NativeWind interop OFF. Raw semantic HTML + Tailwind className only. No
 *     <View>/<Text>. State = Zustand only (no useState).
 *   - Tiles fill the screen (object-cover); local PiP rounded-2xl. Controls bar
 *     = circular icon buttons. bg #06070d/black, accent cyan #3FDCFF, end-call rose.
 *   - Navigation via solito useRouter; leave → router.back().
 */

import { useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "solito/navigation";
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
import { videoApi } from "@dvnt/app/src/video/api";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVideoRoomStore } from "@dvnt/app/src/video/stores/video-room-store";
import type { Participant } from "@dvnt/app/src/video/types";
import { useCallUIStore } from "./call-ui-store";

const ACCENT = "#3FDCFF";

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
    <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-white/10 text-3xl font-semibold text-white">
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

// ── Inner screen — rendered INSIDE FishjamProvider so SDK hooks are valid ─────
function CallRoom({ roomId }: { roomId: string }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

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

  const initStarted = useCallUIStore((s) => s.initStarted);
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
    if (initStarted || !roomId) return;
    setInitStarted(true);

    let cancelled = false;

    (async () => {
      const s = getStore();
      s.clearError();
      s.setCallType("video");
      s.setRoomId(roomId);

      // 1) Resolve Fishjam peer token via the SHARED video API (Supabase edge
      //    fn `video_join_room`). Identical token path to the native hook.
      s.setCallPhase("joining_room");
      const joinResult = await videoApi.joinRoom(roomId);
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
  }, [roomId, initStarted, setInitStarted, getStore]);

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

  const leave = useCallback(() => {
    const s = getStore();
    const duration = s.callDuration;
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
    s.setCallEnded(duration);
    router.back();
  }, [getStore, router]);

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
  const remote = participants[0];
  const remoteStream: MediaStream | null =
    (remote?.videoTrack as any)?.stream ?? null;
  const remoteName = remote?.username || "Connecting…";

  const connecting =
    callPhase === "joining_room" ||
    callPhase === "connecting_peer" ||
    callPhase === "starting_media";

  const statusLabel =
    callPhase === "error"
      ? errorMsg || "Call failed"
      : connectionStatus === "connected" && remote
        ? remoteName
        : connecting
          ? "Connecting…"
          : remote
            ? remoteName
            : "Waiting for others…";

  return (
    <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#06070d]">
      {/* Remote tile fills the screen */}
      <div className="absolute inset-0">
        {remoteStream ? (
          <VideoTile
            stream={remoteStream}
            muted={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black">
            <AvatarFallback name={remoteName} avatar={remote?.avatar} />
            <p className="text-lg font-medium text-white">{statusLabel}</p>
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
      <header className="relative z-10 flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 backdrop-blur">
          <span
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                connectionStatus === "connected"
                  ? ACCENT
                  : callPhase === "error"
                    ? "#f43f5e"
                    : "#facc15",
            }}
          />
          <span className="text-sm font-medium text-white">{statusLabel}</span>
        </div>
      </header>

      {/* Local PiP tile — rounded-2xl */}
      {localStream && isCameraOn ? (
        <div className="absolute right-4 top-20 z-10 h-44 w-32 overflow-hidden rounded-2xl border border-white/15 shadow-lg">
          <VideoTile
            stream={localStream}
            muted
            mirror
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      {/* Controls bar — circular icon buttons */}
      <footer className="relative z-10 mt-auto flex items-center justify-center gap-5 pb-10">
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

  return (
    <FishjamProvider fishjamId={resolveFishjamAppId()}>
      <CallRoom roomId={roomId} />
    </FishjamProvider>
  );
}

export default CallScreen;
