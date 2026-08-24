"use client";

/**
 * Sneaky Lynk room — WEB media tiles and controls.
 *
 * The second half of the room.web.tsx extraction (see room-panels.tsx for the
 * side panels). Same rationale: pure presentation, prop-driven, closing over
 * nothing in the screen, so it moves without a seam.
 *
 * Web-only and deliberately not in the four-file shape — the native room draws
 * these with Viro/RN primitives and a WebRTC RTCView, which is a different
 * renderer rather than the same component forked.
 *
 * HARD CONVENTIONS: raw semantic HTML + Tailwind className only, no
 * <View>/<Text>. Video tiles object-cover, control buttons circular, avatars
 * rounded SQUARES.
 */

import { useCallback } from "react";
import { Crown, Hand, Mic, MicOff, Zap } from "lucide-react";

import { SquareAvatar } from "./room-panels";

/** DVNT tokens — docs/dvnt-design-system.md §1. */
const PURPLE = "#8A40CF";


export type Tile = {
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

export const REACTION_EMOJIS = ["❤️", "🔥", "👏", "😮", "😂", "🙌"];

export function VideoTile({
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

export function ControlButton({
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

export function FloatingReactions({
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

export function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
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

export function TimeUpDialog({
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

export function StageTile({ tile, large }: { tile: Tile; large?: boolean }) {
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

