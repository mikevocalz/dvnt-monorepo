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
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { useRoomStore } from "@dvnt/app/src/sneaky-lynk/stores/room-store";
import { useLynkHistoryStore } from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { useRoomUIStore } from "./room-ui-store";

const ACCENT = "#3FDCFF";
const ROSE = "#FC253A";

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

  return (
    <main className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#06070d] text-white">
      {/* Header */}
      <header
        className="relative z-10 flex items-center justify-between px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={leave}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={20} color="#fff" />
        </button>
        <div className="flex flex-col items-center">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: connecting ? "#facc15" : ACCENT }}
            />
            <span className="text-[15px] font-semibold truncate max-w-[60vw]">{roomTitle}</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-white/50">
            <Users size={12} /> {participantCount}
          </span>
        </div>
        <span className="w-9" />
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

      {/* Controls bar */}
      <footer className="relative z-10 flex items-center justify-center gap-4 pb-8 pt-2">
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

        <ControlButton onClick={leave} danger label="Leave Lynk">
          <PhoneOff size={24} />
        </ControlButton>
      </footer>
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
