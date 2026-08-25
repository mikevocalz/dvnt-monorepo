"use client";

/**
 * EjectModal — WEB. A blocking overlay, not a banner.
 *
 * This replaces an inline `EjectBanner` in room.web.tsx which was already a
 * full-screen blocking overlay — only the name suggested otherwise. What it
 * genuinely lacked was the distinction the native leg has always drawn: it
 * received the kick/ban action and flattened it into one sentence, so a ban
 * read "removed by the host" and never said it was permanent, and a room
 * simply ending rendered through the same "you were ejected" surface.
 *
 * HARD CONVENTIONS (room.web.tsx): raw semantic HTML + Tailwind className only,
 * no <View>/<Text>. Tokens from docs/dvnt-design-system.md — `signal #FC253A`
 * for the ban (destructive), `gold #F5C518` for a reversible removal, neutral
 * for a room that just ended. The previous copy used tailwind's rose-500, which
 * is not a DVNT token, and a `rounded-full` button, which the system rules out
 * for content ("buttons and chips use sm (8), no pills").
 */

import { Ban, ShieldX, DoorClosed } from "lucide-react";

export type { EjectKind, EjectModalProps } from "./EjectModal.types";
import { EJECT_COPY } from "./EjectModal.types";
import type { EjectModalProps } from "./EjectModal.types";

const KIND = {
  ban: { color: "#FC253A", Icon: Ban },
  kick: { color: "#F5C518", Icon: ShieldX },
  room_ended: { color: "rgba(255,255,255,0.60)", Icon: DoorClosed },
} as const;

export function EjectModal({ visible, kind, reason, onDismiss }: EjectModalProps) {
  if (!visible || !kind) return null;
  const { color, Icon } = KIND[kind];
  const copy = EJECT_COPY[kind];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="eject-title"
      className="absolute inset-0 z-[60] flex items-center justify-center bg-[#02030A]/85 px-6 text-center"
    >
      <div className="w-full max-w-sm">
        <span
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl border"
          style={{ backgroundColor: `${color}1f`, borderColor: `${color}40` }}
        >
          <Icon size={32} color={color} aria-hidden="true" />
        </span>
        <h2 id="eject-title" className="text-xl font-bold text-white">
          {copy.title}
        </h2>
        <p className="mt-2 text-sm text-white/60">{copy.body}</p>
        {reason ? (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/70">
            {reason}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          autoFocus
          className="mt-7 w-full rounded-lg bg-white/[0.08] py-3.5 font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
        >
          {copy.cta}
        </button>
      </div>
    </div>
  );
}
