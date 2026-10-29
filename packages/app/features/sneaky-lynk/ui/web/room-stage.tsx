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

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Crown, Hand, Mic, MicOff, RotateCw, Smile, Zap } from "lucide-react";

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
      title={label}
      className={`flex h-11 w-11 min-[360px]:h-12 min-[360px]:w-12 shrink-0 items-center justify-center rounded-full text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FDCFF] sm:h-14 sm:w-14 [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:w-11 ${bg}`}
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
    <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-lg bg-white/8 px-1">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSend(emoji)}
          aria-label={`React ${emoji}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** One reactions control at every size. The picker overlays the stage only
 * while open, so portrait phones do not lose a permanent row of video space. */
export function ReactionsPicker({ onSend, overlayOpen = false }: { onSend: (emoji: string) => void; overlayOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const paletteId = useId();
  useEffect(() => { if (overlayOpen) setOpen(false); }, [overlayOpen]);
  useEffect(() => {
    if (!open) return;
    paletteRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="shrink-0" onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <button
        type="button"
        ref={buttonRef}
        aria-label="Reactions"
        aria-expanded={open}
        aria-controls={open ? paletteId : undefined}
        title="Reactions"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 min-[360px]:h-12 min-[360px]:w-12 sm:h-14 sm:w-14 [@media(max-height:500px)]:h-11 [@media(max-height:500px)]:w-11 items-center justify-center rounded-full bg-white/15 text-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
      ><Smile size={24} /></button>
      {open ? (
        <div ref={paletteRef} id={paletteId} role="group" aria-label="Choose a reaction" className="absolute bottom-[calc(100%+8px)] left-1/2 w-max max-w-[calc(100%-16px)] -translate-x-1/2 rounded-xl border border-white/15 bg-[#090b15] p-1">
          <ReactionBar onSend={(emoji) => { onSend(emoji); setOpen(false); buttonRef.current?.focus({ preventScroll: true }); }} />
        </div>
      ) : null}
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
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialogRef.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = panel?.querySelectorAll<HTMLButtonElement>("button");
      const first = buttons?.[0];
      const last = buttons?.[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    panel?.addEventListener("keydown", keepFocus);
    return () => {
      panel?.removeEventListener("keydown", keepFocus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Session time limit" className="absolute inset-0 z-[60] flex items-center justify-center bg-black/90 px-3" style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 12px)", paddingTop: "calc(var(--lynk-safe-top, env(safe-area-inset-top)) + 12px)" }}>
      <div className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl bg-[#0b0d14] px-6 pb-8 pt-7">
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
  const tileRef = useRef<HTMLDivElement | null>(null);
  // MoQ exposes no camera orientation metadata to the web watcher. A blanket
  // transform would break upright cameras, so correction is per remote tile.
  const [rotation, setRotation] = useState(0);
  const [tileSize, setTileSize] = useState({ width: 0, height: 0 });

  useEffect(() => setRotation(0), [canvasPath]);

  useEffect(() => {
    const el = tileRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setTileSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Rotate the cover box with the camera: exchange dimensions on quarter turns
  // so portrait feeds fill the tile without stretching or side gutters.
  const sideways = rotation % 180 !== 0;
  const canvasStyle = {
    left: "50%",
    top: "50%",
    width: sideways ? (tileSize.height || "100%") : "100%",
    height: sideways ? (tileSize.width || "100%") : "100%",
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    objectFit: "cover" as const,
    // Keep the player mounted for audio/recovery, but never show a stale frame.
    opacity: tile.isCameraOn ? 1 : 0,
  };
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
      data-video-rotation={rotation}
      ref={tileRef}
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
          above it is hidden until MoQ has available video, so a camera-off
          participant reads as their avatar while their audio still plays. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <SquareAvatar uri={tile.avatar} name={tile.name} size={88} />
      </div>
      {canvasPath ? (
        <canvas
          ref={canvasRef}
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
          className="absolute object-cover"
          style={canvasStyle}
        />
      ) : tile.isCameraOn && tile.videoStream ? (
        <VideoTile
          stream={tile.videoStream}
          muted={tile.isLocal}
          mirror={tile.isLocal}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {canvasPath && !tile.isLocal ? (
        <button
          type="button"
          aria-label={`Rotate ${tile.name}'s video clockwise`}
          title="Video sideways? Rotate 90°"
          onClick={() => setRotation((angle) => (angle + 90) % 360)}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-black/65 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
        >
          <RotateCw size={16} aria-hidden="true" />
        </button>
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

