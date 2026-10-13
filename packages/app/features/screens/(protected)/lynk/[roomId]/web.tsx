"use client";

/**
 * Lynk Live — WEB screen (broadcaster + viewer).
 *
 * Transport: MoQ via `@moq` (host/cohost publish → relay → many viewers). The
 * media layer is hidden behind `useLynkBroadcast` / `useLynkViewer` + the shared
 * `<VideoTile>`, so this screen is transport-agnostic. Reuses the existing Lynk
 * room model (roomId + private membership) — the prompt is a transport migration,
 * not a new room concept (see docs/lynk-moq-fit.md).
 *
 * `?isHost=1` (or a publish-capable role) → broadcaster stage; otherwise viewer.
 * Web convention: semantic HTML + Tailwind, explicit capture opt-in, avatars rounded SQUARE, bg #06070d, accent cyan #3FDCFF.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import { VideoTile } from "@dvnt/ui";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.web";
import { useLynkViewer } from "@dvnt/app/lib/lynk/useLynkViewer.web";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useGenesisRoomAdmission, type GenesisRoomAdmission } from "@dvnt/app/lib/lynk/genesis-room-admission";
import { isPublisherRole } from "@dvnt/app/features/sneaky-lynk/publish-roles";
import { lynkStateLabel, isTerminalLynkState } from "@dvnt/app/lib/lynk/lynkState";

function StagePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
      {children}
    </span>
  );
}

function BroadcasterStage({ roomId, session }: { roomId: string; session: GenesisRoomAdmission }) {
  const [captureOptIn, setCaptureOptIn] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const lynk = useLynkBroadcast(roomId, captureOptIn && isPublisherRole(session.role));
  useEffect(() => {
    if (captureOptIn && !lynk.isLive) void lynk.goLive();
  }, [captureOptIn, lynk.isLive, lynk.goLive]);
  useEffect(() => {
    if (captureOptIn && lynk.error) {
      setCaptureError(lynk.error);
      setCaptureOptIn(false);
    }
  }, [captureOptIn, lynk.error]);
  useEffect(() => session.onTransportState(lynk.state), [lynk.state, session.onTransportState]);

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StagePill>
            <span className="text-[#FC253A]">● </span>
            {lynkStateLabel(lynk.state, "broadcaster")}
          </StagePill>
          <StagePill>{lynk.viewerCount} watching</StagePill>
        </div>
        <button
          disabled={session.leaving}
          onClick={() => void session.leave()}
          className="rounded-full bg-[#FC253A] px-4 py-2 text-sm font-semibold text-white"
        >
          {session.leaving ? "Ending…" : session.role === "host" ? "End Lynk" : "Leave"}
        </button>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Host local preview */}
        <VideoTile
          stream={lynk.localStream}
          mirror
          muted
          label="You"
          isSpeaking={lynk.cameraEnabled}
          className="aspect-video w-full"
        />
        {/* Co-publishers (cohost) — discovery-driven, no reload */}
        {lynk.coPublishers.map((p) => (
          <VideoTile
            key={p.path}
            canvasRef={(el) => lynk.attachCanvas(p.path, el)}
            label="Cohost"
            className="aspect-video w-full"
          />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        {!captureOptIn || !lynk.isLive ? (
          <button
            onClick={() => { setCaptureError(null); setCaptureOptIn(true); }}
            disabled={captureOptIn}
            className="rounded-full bg-[#3FDCFF] px-6 py-3 text-sm font-bold text-black"
          >
            {captureOptIn ? "Connecting…" : "Go Live"}
          </button>
        ) : (
          <>
            <button
              onClick={() => lynk.setCameraEnabled(!lynk.cameraEnabled)}
              className="rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white"
            >
              {lynk.cameraEnabled ? "Camera off" : "Camera on"}
            </button>
            <button
              onClick={() => lynk.setMicEnabled(!lynk.micEnabled)}
              className="rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-white"
            >
              {lynk.micEnabled ? "Mute" : "Unmute"}
            </button>
          </>
        )}
      </div>

      {captureError || lynk.error ? (
        <p className="text-center text-sm text-[#FC253A]">{captureError || lynk.error}</p>
      ) : null}
    </div>
  );
}

function ViewerStage({ roomId, session }: { roomId: string; session: GenesisRoomAdmission }) {
  const lynk = useLynkViewer(roomId);
  useEffect(() => session.onTransportState(lynk.state), [lynk.state, session.onTransportState]);
  const empty = lynk.publishers.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <StagePill>
          <span className="text-[#FC253A]">● </span>
          {lynkStateLabel(lynk.state, "viewer")}
        </StagePill>
        <div className="flex items-center gap-2">
          <button disabled={session.leaving} onClick={() => void session.leave()}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white">
            {session.leaving ? "Ending…" : session.role === "host" ? "End Lynk" : "Leave"}
          </button>
          <button
            onClick={() => lynk.setMuted(!lynk.muted)}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
          >
            {lynk.muted ? "Unmute" : "Mute"}
          </button>
        </div>
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-center text-white/60">
            {isTerminalLynkState(lynk.state)
              ? lynkStateLabel(lynk.state, "viewer")
              : "Waiting for the stream to start…"}
          </p>
        </div>
      ) : (
        <div
          className={`grid flex-1 gap-4 ${lynk.publishers.length >= 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}
        >
          {lynk.publishers.map((p) => (
            <VideoTile
              key={p.path}
              canvasRef={(el) => lynk.attachCanvas(p.path, el)}
              muted={lynk.muted}
              className="aspect-video w-full"
            />
          ))}
        </div>
      )}

      {lynk.error ? (
        <p className="text-center text-sm text-[#FC253A]">{lynk.error}</p>
      ) : null}
    </div>
  );
}

function AdmittedRoom({ roomId, requestedBroadcast }: { roomId: string; requestedBroadcast: boolean }) {
  const router = useRouter();
  const session = useGenesisRoomAdmission(roomId, () => router.back());
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void session.leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session.leave]);

  return (
    <div className="flex min-h-screen flex-col bg-[#06070d]">
      {session.admitted ? (
        requestedBroadcast && isPublisherRole(session.role)
          ? <BroadcasterStage key={session.mediaKey} roomId={roomId} session={session} />
          : <ViewerStage key={session.mediaKey} roomId={roomId} session={session} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-white">
          <p role="status">{session.message || (session.phase === "joining" ? "Joining Lynk…" : "Lynk paused")}</p>
          {session.phase === "error" && <button onClick={() => void session.join()}
            className="rounded-full bg-[#3FDCFF] px-6 py-3 font-bold text-black">Try again</button>}
          <button onClick={() => void session.leave()} className="rounded-full bg-white/10 px-6 py-3">Leave</button>
        </div>
      )}
      {session.admitted && session.message && <p role="alert" className="p-4 text-center text-[#FC253A]">{session.message}</p>}
    </div>
  );
}

export default function LynkRoomWeb() {
  const params = useParams();
  const search = useSearchParams();
  const account = useAuthStore((state) => state.user?.authId || state.user?.id || "");
  const roomId = String((params as Record<string, unknown>)?.roomId ?? "");
  if (!roomId) return <div className="flex min-h-screen items-center justify-center bg-[#06070d] text-white/60">Missing room</div>;
  return <AdmittedRoom key={JSON.stringify([roomId, account])} roomId={roomId} requestedBroadcast={search?.get("isHost") === "1"} />;
}
