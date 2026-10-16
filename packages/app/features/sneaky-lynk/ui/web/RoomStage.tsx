"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { stageGridClass, stageMode } from "../stage-grid";
import { StageTile, type Tile } from "./room-stage";

/** One keyed media tree: changing focus must never detach a publisher's canvas
 * (the canvas also owns their audio subscription). Only CSS order changes. */
export function RoomStage({ tiles }: { tiles: Tile[] }) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealFocusRef = useRef(false);
  const group = tiles.length > 2;
  const focusedKey = tiles.some((tile) => tile.key === pinnedKey)
    ? pinnedKey
    : (tiles.find((tile) => tile.isHost) ?? tiles[0])?.key;

  useEffect(() => {
    if (pinnedKey && !tiles.some((tile) => tile.key === pinnedKey)) {
      revealFocusRef.current = true;
      setPinnedKey(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [tiles, pinnedKey]);

  useEffect(() => {
    if (!revealFocusRef.current) return;
    revealFocusRef.current = false;
    // The room content may itself have scrolled on a short phone. Resetting
    // only the participant rail can leave the newly focused face above it.
    scrollRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusedKey, pinnedKey]);

  const focus = (key: string | null) => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    if (key === pinnedKey) {
      scrollRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    revealFocusRef.current = true;
    setPinnedKey(key);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
      {group ? (
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 text-xs text-white/70">
          <span>{tiles.length} on stage · Scroll for everyone</span>
          {pinnedKey ? (
            <button type="button" onClick={() => focus(null)} className="min-h-11 rounded-lg px-3 text-[#3FDCFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">Reset focus</button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        data-stage-scroll
        tabIndex={group ? 0 : undefined}
        role={group ? "region" : undefined}
        aria-label={group ? "Call participants. Scroll to see everyone." : undefined}
        className={`min-h-0 flex-1 overscroll-contain rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF] ${group ? "overflow-y-auto [@media(max-height:500px)_and_(min-width:600px)]:scroll-pt-0" : "flex"}`}
        style={group ? { scrollbarGutter: "stable", scrollPaddingTop: "calc(clamp(144px, 26dvh, 280px) + 8px)" } : undefined}
      >
        <div
          data-stage-mode={stageMode(tiles.length)}
          data-stage-count={tiles.length}
          style={{ "--lynk-crowd-rows": Math.ceil((tiles.length - 1) / 2) } as CSSProperties}
          className={`mx-auto grid w-full gap-2 sm:gap-3 ${group ? "max-w-6xl grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 [@media(max-height:500px)_and_(min-width:600px)]:grid-cols-[minmax(0,1.25fr)_repeat(2,minmax(0,1fr))]" : `min-h-0 flex-1 auto-rows-fr ${tiles.length === 1 ? "max-w-4xl" : "max-w-6xl"} ${stageGridClass(tiles.length)}`}`}
        >
          {tiles.map((tile) => {
            const focused = group && tile.key === focusedKey;
            return (
              <div
                key={tile.key}
                data-stage-card={tile.key}
                data-focused={focused ? "true" : "false"}
                className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-[#0b0d14] ${group ? focused ? "sticky top-0 z-20 col-span-full h-[clamp(144px,26dvh,280px)] [@media(max-height:500px)_and_(min-width:600px)]:col-span-1 [@media(max-height:500px)_and_(min-width:600px)]:col-start-1 [@media(max-height:500px)_and_(min-width:600px)]:row-start-1 [@media(max-height:500px)_and_(min-width:600px)]:row-span-[var(--lynk-crowd-rows)] [@media(max-height:500px)_and_(min-width:600px)]:h-32" : "h-32 sm:h-40 [@media(max-height:500px)_and_(min-width:600px)]:h-32" : ""}`}
                style={focused ? { order: -1 } : undefined}
              >
                <div className="min-h-0 flex-1"><StageTile tile={tile} /></div>
                {group ? (
                  <button
                    type="button"
                    aria-label={`Focus ${tile.name}`}
                    aria-pressed={focused}
                    onClick={() => focus(tile.key)}
                    className="flex h-11 shrink-0 items-center justify-center gap-2 px-2 text-xs font-semibold text-white/80 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#3FDCFF]"
                  >
                    {focused ? <span className="text-[#3FDCFF]">Focused</span> : "Focus"}
                    {tile.isSpeaking ? <span className="text-[#3FDCFF]">· Speaking</span> : null}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
