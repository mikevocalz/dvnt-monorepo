"use client";

/**
 * VideoTile (WEB) — renders, in priority order:
 *   1. `canvasRef`  → a `<canvas>` for the MoQ WebCodecs decoder
 *      (`Watch.MultiBackend` paints here). This is the Lynk Live viewer/cohost tile.
 *   2. `stream`     → a `<video>` bound to a MediaStream (Fishjam WebRTC call, or
 *      the broadcaster's local camera preview).
 *   3. avatar fallback (rounded SQUARE) when there's no live media.
 *
 * Web HARD CONVENTION: raw semantic HTML + Tailwind only. Avatars rounded square.
 */

import { useCallback } from "react";
import type { VideoTileProps } from "./VideoTile.types";

export function VideoTile({
  stream,
  canvasRef,
  mirror,
  objectFit = "cover",
  muted = true,
  className,
  label,
  avatarUrl,
  isSpeaking,
}: VideoTileProps) {
  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== (stream ?? null)) {
        el.srcObject = stream ?? null;
      }
    },
    [stream],
  );

  const ring = isSpeaking ? "ring-2 ring-[#3FDCFF]" : "ring-0";
  const fit = objectFit === "contain" ? "object-contain" : "object-cover";
  const mirrorStyle = mirror ? { transform: "scaleX(-1)" } : undefined;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-black ${ring} ${className ?? ""}`}
    >
      {canvasRef ? (
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full ${fit}`}
          style={mirrorStyle}
        />
      ) : stream ? (
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted={muted}
          className={`absolute inset-0 h-full w-full ${fit}`}
          style={mirrorStyle}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f17]">
          {avatarUrl ? (
            // Rounded SQUARE avatar — never circular.
            <img
              src={avatarUrl}
              alt={label ?? ""}
              className="h-20 w-20 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#1b1f2b] text-2xl font-semibold text-white/70">
              {(label ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
      )}

      {label ? (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
          {label}
        </span>
      ) : null}
    </div>
  );
}
