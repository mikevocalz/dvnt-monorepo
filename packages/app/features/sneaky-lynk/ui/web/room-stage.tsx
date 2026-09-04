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
  /** Local tile only — the camera capture, bound to a `<video>`. */
  videoStream: MediaStream | null;
  /**
   * Remote tile only — MoQ decodes into a `<canvas>`, so a remote participant
   * has no MediaStream to bind. Mounting the canvas is also what starts their
   * AUDIO, so it is always rendered, never conditional on knowing whether their
   * camera is on (web MoQ discovery announces a path, not a track list). An
   * untouched canvas is transparent, so the avatar behind it shows through
   * until frames arrive.
   *
   * The PATH and the attach function are passed separately, not a pre-bound
   * ref: `attachCanvas(path, null)` closes the subscription, so a ref whose
   * identity changed every render would tear the stream down and rebuild it on
   * every keystroke in the chat. `StageTile` memoizes them into one stable ref.
   */
  canvasPath?: string;
  attachCanvas?: (path: string, el: HTMLCanvasElement | null) => void;
  isCameraOn: boolean;
  isMicOn: boolean;
  /** Their ROLE can publish (host / co-host / speaker), so they get a stage
   *  tile rather than an avatar in the audience row. */
  isPublisher?: boolean;
  /** Currently the active speaker — the tile gets a ring, the way WhatsApp and
   *  Discord mark who is talking. Without it a silent grid gives no clue where
   *  to look. */
  isSpeaking?: boolean;
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
    ? "bg-[#FC253A] hover:bg-[#FC253A]"
    : active
      ? "bg-white/15 hover:bg-white/25"
      : "bg-white/30 hover:bg-white/40";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Toggle state was colour-only; expose it so a screen reader can tell a
      // muted mic from a live one. `danger` (Leave) is an action, not a toggle,
      // so it stays unpressed.
      aria-pressed={danger ? undefined : !!active}
      // Circular by this screen's own convention ("control buttons circular"),
      // which the design system allows alongside status dots and the shutter.
      className={`flex h-14 w-14 items-center justify-center rounded-full text-white transition-colors ${bg}`}
    >
      {children}
    </button>
  );
}

/**
 * Floating reaction burst.
 *
 * Single renderer, deliberately. A WebGPU overlay used to draw these with the
 * DOM path suppressed whenever the GPU reported available — so any failure to
 * initialise the canvas made reactions silently invisible, which is how they
 * came to "not work". Six emoji drifting up the screen do not need a GPU, and a
 * path that can vanish is worse than one that is slightly less clever.
 *
 * Spread across the full stage rather than a 160px box: reactions used to stack
 * inside `h-40 w-40` centred at the bottom, so more than two overlapped into an
 * unreadable pile. Position and timing are derived from the reaction id, so
 * every emoji takes its own path and re-renders do not make them jump.
 *
 * Honours prefers-reduced-motion by holding them still and fading — the
 * information is "someone reacted", and that survives without the travel.
 */
export function FloatingReactions({
  reactions,
}: {
  reactions: { id: string; emoji: string }[];
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-24 top-0 z-30 overflow-hidden"
    >
      {reactions.map((r) => {
        // Deterministic per-id jitter: stable across renders, varied between
        // reactions. A shared path would read as one animation, not many people.
        let h = 0;
        for (let i = 0; i < r.id.length; i += 1) h = (h * 31 + r.id.charCodeAt(i)) | 0;
        const spread = Math.abs(h) % 100;
        const drift = ((Math.abs(h >> 3) % 60) - 30) / 10;
        const duration = 2.2 + ((Math.abs(h >> 7) % 12) / 10);
        const scale = 0.9 + ((Math.abs(h >> 11) % 5) / 10);
        return (
          <span
            key={r.id}
            className="lynk-reaction absolute bottom-0 select-none text-4xl motion-reduce:animate-none"
            style={{
              left: `${6 + spread * 0.88}%`,
              animationDuration: `${duration}s`,
              ["--lynk-drift" as string]: `${drift}rem`,
              ["--lynk-scale" as string]: String(scale),
            }}
          >
            {r.emoji}
          </span>
        );
      })}
    </div>
  );
}

export function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/8 px-2 py-1">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSend(emoji)}
          aria-label={`React ${emoji}`}
          className="rounded-lg px-1.5 py-0.5 text-lg transition-transform hover:scale-125"
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
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
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
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg py-3.5 font-bold text-white"
          style={{ backgroundColor: PURPLE }}
        >
          <Zap size={16} /> Upgrade plan
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="mt-3 w-full rounded-lg bg-white/8 py-3.5 font-semibold text-white/80 hover:bg-white/15"
        >
          Leave Lynk
        </button>
      </div>
    </div>
  );
}

/**
 * One person on the stage.
 *
 * No `large` prop any more. It existed so the host could be drawn at
 * `aspect-video` while everyone else got a small `aspect-square` — which
 * cropped 16:9 camera output to a box AND said, at a glance, that the guests
 * mattered less. Every tile now fills its grid cell; the grid owns the shape,
 * the speaking ring owns the emphasis.
 */
export function StageTile({ tile }: { tile: Tile }) {
  const { canvasPath, attachCanvas } = tile;
  // Stable across re-renders, so the MoQ backend is created once per publisher
  // and closed only when the tile really goes away.
  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (canvasPath && attachCanvas) attachCanvas(canvasPath, el);
    },
    [canvasPath, attachCanvas],
  );

  return (
    <div
      // The ring is colour-only, so nothing but a human eye can read it. This
      // attribute is the observable seam the e2e asserts on, and the hook an
      // a11y pass will hang a live region off.
      data-speaking={tile.isSpeaking ? "true" : "false"}
      data-tile={tile.isLocal ? "local" : tile.key}
      // Speaking is a RING, not a background or a glow: it reads at thumbnail
      // size, survives on top of video, and costs no contrast against the tile.
      // Cyan rather than signal — someone talking is not an alert.
      className={`relative h-full min-h-0 w-full overflow-hidden rounded-2xl border bg-white/[0.04] transition-[box-shadow,border-color] duration-200 ${
        tile.isSpeaking
          ? "border-[#3FDCFF]/70 shadow-[0_0_0_2px_rgba(63,220,255,0.45)]"
          : "border-white/8"
      }`}
    >
      {/* Avatar is the FLOOR of the tile, not an alternative to it: the canvas
          above it is transparent until MoQ decodes a frame, so a camera-off
          participant reads as their avatar while their audio still plays. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <SquareAvatar uri={tile.avatar} name={tile.name} size={88} />
      </div>
      {canvasPath ? (
        <canvas
          ref={canvasRef}
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : tile.isCameraOn && tile.videoStream ? (
        <VideoTile
          stream={tile.videoStream}
          muted={tile.isLocal}
          mirror={tile.isLocal}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {/* Muted reads as a badge in the corner, the way Discord and Skype show
          it, so it is legible at thumbnail size and against moving video. A
          dimmed inline icon in a name row was invisible on a busy tile. */}
      {!tile.isMicOn ? (
        <span
          className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg bg-black/65 backdrop-blur-sm"
          aria-label={`${tile.name} is muted`}
        >
          <MicOff size={13} className="text-white/90" />
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4">
        <span className="truncate text-xs font-medium">{tile.name}</span>
        {tile.isHost || tile.isCoHost ? (
          // Role as a chip, not a suffix on the name: it stops the role being
          // truncated away first on a narrow tile.
          <span className="shrink-0 rounded bg-white/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white/80">
            {tile.isHost ? "Host" : "Co-host"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

