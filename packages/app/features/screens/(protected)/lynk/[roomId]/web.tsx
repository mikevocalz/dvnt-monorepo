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
 * Web convention: semantic HTML + Tailwind, Zustand-not-useState for screen
 * state, avatars rounded SQUARE, bg #06070d, accent cyan #3FDCFF.
 */

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "solito/navigation";
import { VideoTile } from "@dvnt/ui";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.web";
import { useLynkViewer } from "@dvnt/app/lib/lynk/useLynkViewer.web";
import { lynkStateLabel, isTerminalLynkState } from "@dvnt/app/lib/lynk/lynkState";

function StagePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
      {children}
    </span>
  );
}

function BroadcasterStage({ roomId }: { roomId: string }) {
  const lynk = useLynkBroadcast(roomId);
  const router = useRouter();

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
          onClick={() => {
            lynk.end();
            router.back();
          }}
          className="rounded-full bg-[#FC253A] px-4 py-2 text-sm font-semibold text-white"
        >
          End Lynk
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
        {!lynk.isLive ? (
          <button
            onClick={() => void lynk.goLive()}
            className="rounded-full bg-[#3FDCFF] px-6 py-3 text-sm font-bold text-black"
          >
            Go Live
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

      {lynk.error ? (
        <p className="text-center text-sm text-[#FC253A]">{lynk.error}</p>
      ) : null}
    </div>
  );
}

function ViewerStage({ roomId }: { roomId: string }) {
  const lynk = useLynkViewer(roomId);
  const empty = lynk.publishers.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <StagePill>
          <span className="text-[#FC253A]">● </span>
          {lynkStateLabel(lynk.state, "viewer")}
        </StagePill>
        <div className="flex items-center gap-2">
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

export default function LynkRoomWeb() {
  const params = useParams();
  const search = useSearchParams();
  const roomId = String((params as Record<string, unknown>)?.roomId ?? "");
  const isHost = search?.get("isHost") === "1";

  // Privacy: keyboard shortcut to leave fast (Esc) — teardown handled by hooks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.history.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!roomId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#06070d] text-white/60">
        Missing room
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#06070d]">
      {isHost ? <BroadcasterStage roomId={roomId} /> : <ViewerStage roomId={roomId} />}
    </div>
  );
}
