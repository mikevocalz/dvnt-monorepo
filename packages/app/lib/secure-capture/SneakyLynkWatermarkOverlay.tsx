"use client";

import { useEffect, useMemo, useState } from "react";

function maskId(value?: string): string {
  if (!value) return "dvnt";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const label = useMemo(() => {
    const actor = userHandle ? `@${userHandle}` : `user ${maskId(userId)}`;
    const room = `room ${maskId(roomId)}`;
    const session = sessionId ? `session ${maskId(sessionId)}` : "web";
    return `${actor} · ${room} · ${session}`;
  }, [roomId, sessionId, userHandle, userId]);

  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const offset = tick % 2 === 0 ? "-translate-x-4" : "translate-x-4";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[55] overflow-hidden mix-blend-screen"
    >
      <div
        className={`absolute -inset-24 grid rotate-[-24deg] grid-cols-3 gap-10 opacity-[0.18] transition-transform duration-1000 ${offset}`}
      >
        {Array.from({ length: 24 }).map((_, index) => (
          <div
            key={index}
            className="whitespace-nowrap rounded-lg border border-white/10 bg-black/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70 shadow-lg backdrop-blur-sm"
          >
            {label} · {timestamp}
          </div>
        ))}
      </div>
    </div>
  );
}
