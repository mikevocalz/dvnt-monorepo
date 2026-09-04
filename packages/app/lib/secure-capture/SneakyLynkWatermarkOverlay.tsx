"use client";

import { useEffect, useState } from "react";

/**
 * Forensic watermark.
 *
 * This is ATTRIBUTION, not prevention. macOS ⌘⇧3/4/5 and Windows Win+Shift+S
 * are consumed by the OS before the page sees anything, so those screenshots
 * are undetectable — the guard cannot fire, the room is never notified. What
 * this overlay guarantees instead is that any such image carries the capturer's
 * handle, room, session, and minute, recoverable by anyone who brightens or
 * levels-adjusts it.
 *
 * That goal sets the styling: plain text, no chrome. A bordered, blurred,
 * shadowed card at 18% opacity (the first treatment) was loud enough over live
 * video that the watermark shipped disabled — which is the worst of both
 * worlds. Near-invisible at rest, legible under levels, is the target.
 *
 * `mix-blend-screen` is what the second treatment got wrong. Screen blending
 * only ever LIGHTENS, so over the dark frame a live room actually is, 6% white
 * text stopped being a watermark and became diagonal streaks across everyone's
 * face — reported as "lines going through my video". Normal compositing at
 * 3.5% is invisible over both a dark room and a blown-out window, and still
 * comes back under a levels adjustment, which is the only thing it owes.
 *
 * `pointer-events-none` + `aria-hidden` are load-bearing: the overlay covers
 * the whole stage and must never intercept a tap or reach a screen reader.
 */

const CELL_COUNT = 48;
/** Re-check the minute twice per minute — cheap, and keeps drift under 30s. */
const TICK_MS = 30_000;

function maskId(value?: string): string {
  if (!value) return "dvnt";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** `YYYY-MM-DD HH:mm`, UTC — unambiguous across the viewer's timezone. */
function utcMinuteStamp(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function SneakyLynkWatermarkOverlay({
  roomId,
  sessionId,
  userId,
  userHandle,
}: {
  roomId?: string;
  sessionId?: string;
  userId?: string;
  userHandle?: string;
}) {
  // Local UI ephemera (a clock tick), not business state — `useState` is the
  // right tool here per the store rule.
  const [timestamp, setTimestamp] = useState(utcMinuteStamp);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // Only re-render when the printed minute actually changes.
      setTimestamp((current) => {
        const next = utcMinuteStamp();
        return next === current ? current : next;
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const actor = userHandle ? `@${userHandle}` : `user ${maskId(userId)}`;
  const room = `room ${maskId(roomId)}`;
  const session = sessionId ? `session ${maskId(sessionId)}` : "web";
  const label = `${actor} · ${room} · ${session} · ${timestamp}`;

  return (
    <div
      aria-hidden="true"
      // z-0: above the video tiles (unpositioned / z-auto) but below the room
      // header, controls, banners, and blackout, which all carry a positive
      // z-index. The watermark must never sit on top of a control.
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -inset-32 grid rotate-[-24deg] grid-cols-4 gap-x-8 gap-y-6 opacity-[0.035]">
        {Array.from({ length: CELL_COUNT }).map((_, index) => (
          <span
            key={index}
            className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
