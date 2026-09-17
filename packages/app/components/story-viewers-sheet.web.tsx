"use client";

/**
 * Who viewed your story — web.
 *
 * Native has had this since stories shipped; web had no way to see it, so the
 * one thing a poster actually wants back from a story was mobile-only. Same
 * `useStoryViewers` query native uses (polled, cached), rendered as a plain
 * scroll list rather than a virtualized one: a story's viewer list is tens of
 * rows, not thousands, and LegendList is native-only anyway.
 *
 * House style: avatars are rounded squares, never circles.
 */

import { useEffect } from "react";
import { X } from "lucide-react";
import { useStoryViewers } from "@dvnt/app/lib/hooks/use-stories";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function StoryViewersSheetWeb({
  storyId,
  open,
  onClose,
  onProfilePress,
}: {
  storyId: string | undefined;
  open: boolean;
  onClose: () => void;
  onProfilePress?: (username: string) => void;
}) {
  const { data: viewers = [], isLoading } = useStoryViewers(
    open ? storyId : undefined,
  );

  // Escape closes the sheet, not the story behind it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 flex flex-col justify-end"
      // Above the player's own 99999 overlay, like every other control here.
      style={{ background: "rgba(0,0,0,0.55)", zIndex: 100001 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[70%] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#0b0b0d] px-4 pb-6 pt-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[15px] font-extrabold text-white">Viewers</p>
            <p className="text-xs text-white/50">
              {isLoading
                ? "Loading…"
                : `${viewers.length} ${viewers.length === 1 ? "person has" : "people have"} seen this`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close viewers"
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/15 bg-white/10"
          >
            <X size={16} color="#fff" />
          </button>
        </div>

        {!isLoading && viewers.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">
            No one has seen this yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {viewers.map((v) => (
              <li key={v.userId}>
                <button
                  onClick={() => onProfilePress?.(v.username)}
                  className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-white/5"
                >
                  {v.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.avatar}
                      alt=""
                      className="h-9 w-9 rounded-lg bg-white/10 object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-white/70">
                      {v.username?.slice(0, 2).toUpperCase() || "??"}
                    </span>
                  )}
                  <span className="flex-1 truncate text-sm font-semibold text-white">
                    {v.username}
                  </span>
                  <span className="text-[11px] text-white/40">
                    {relativeTime(v.viewedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
