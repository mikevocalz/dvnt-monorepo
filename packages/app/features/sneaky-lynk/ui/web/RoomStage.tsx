"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Pin, PinOff } from "lucide-react";
import { stageMode } from "../stage-grid";
import { clampGalleryPage, guestGalleryPosition, roomGalleryLayout } from "../guest-gallery-layout";
import { StageTile, type Tile } from "./room-stage";

/**
 * Host/focus above a swipeable, paginated guest gallery. All media cards remain
 * siblings under one keyed parent: paging, pinning, joining, and resizing only
 * change their positions, never detach a canvas (which also owns its audio).
 */
export function RoomStage({ tiles }: { tiles: Tile[] }) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [measured, setMeasured] = useState({ width: 0, height: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const revealFocusRef = useRef(false);
  const helpId = useId();
  const group = tiles.length > 2;
  const focusedKey = tiles.some((tile) => tile.key === pinnedKey)
    ? pinnedKey
    : (tiles.find((tile) => tile.isHost) ?? tiles[0])?.key;
  const guests = tiles.filter((tile) => tile.key !== focusedKey);
  const layout = roomGalleryLayout(measured.width, measured.height, guests.length);
  const currentPage = clampGalleryPage(page, layout.pageCount);
  const visibleStart = currentPage * layout.pageSize + 1;
  const visibleEnd = Math.min(guests.length, (currentPage + 1) * layout.pageSize);
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      setMeasured((previous) => previous.width === width && previous.height === height
        ? previous : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  useEffect(() => {
    if (pinnedKey && !tiles.some((tile) => tile.key === pinnedKey)) {
      revealFocusRef.current = true;
      setPinnedKey(null);
      setPage(0);
    }
  }, [tiles, pinnedKey]);

  useEffect(() => {
    if (!revealFocusRef.current) return;
    revealFocusRef.current = false;
    scrollRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusedKey, pinnedKey]);

  // Clamp when the last page empties and realign page boundaries after resize.
  useEffect(() => {
    const alignedPage = clampGalleryPage(pageRef.current, layout.pageCount);
    setPage(alignedPage);
    if (scrollRef.current) scrollRef.current.scrollLeft = alignedPage * layout.width;
    // Tracking a partial swipe must not reset scrollLeft mid-gesture. Only
    // changed geometry or a departed page needs imperative realignment.
  }, [layout.width, layout.pageSize, layout.pageCount]);

  useEffect(() => {
    const activeCard = document.activeElement?.closest<HTMLElement>("[data-guest-page]");
    if (activeCard && scrollRef.current?.contains(activeCard) && Number(activeCard.dataset.guestPage) !== currentPage) {
      scrollRef.current.focus({ preventScroll: true });
    }
  }, [currentPage, layout.pageSize, focusedKey]);

  const goToPage = (next: number) => {
    const target = clampGalleryPage(next, layout.pageCount);
    // A swipe or reset can make the active card inert. Keep keyboard focus
    // on the gallery instead of silently abandoning it on an offscreen tile.
    const activeCard = document.activeElement?.closest<HTMLElement>("[data-guest-page]");
    if (activeCard && scrollRef.current?.contains(activeCard) && Number(activeCard.dataset.guestPage) !== target) {
      scrollRef.current.focus({ preventScroll: true });
    }
    setPage(target);
    if (scrollRef.current) scrollRef.current.scrollLeft = target * layout.width;
  };
  const focus = (key: string | null) => {
    goToPage(0);
    if (key === pinnedKey) {
      scrollRef.current?.querySelector<HTMLElement>('[data-focused="true"]')
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    revealFocusRef.current = true;
    setPinnedKey(key);
    // Reset focus removes its own footer button, and unpinning can move the
    // old focused card off-page. Keep a useful keyboard landing point.
    if (key === null) scrollRef.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={rootRef} data-room-stage className="flex min-h-0 w-full flex-1 flex-col items-center">
      <p id={helpId} className="sr-only">
        Focus and video framing only change your view. Audio continues from participants on other pages.
        {layout.pageCount > 1 ? " Swipe or use the left and right arrow keys to change guest pages. Home goes to the first page and End to the last." : ""}
      </p>
      <div
        ref={scrollRef}
        data-stage-scroll
        data-stage-page={currentPage}
        data-stage-pages={layout.pageCount}
        tabIndex={group ? 0 : undefined}
        role={group ? "region" : undefined}
        aria-label={group ? "Guest gallery. Swipe horizontally or use arrow keys for more pages." : undefined}
        aria-describedby={group ? helpId : undefined}
        aria-keyshortcuts={group && layout.pageCount > 1 ? "ArrowLeft ArrowRight PageUp PageDown Home End" : undefined}
        onScroll={(event) => {
          if (layout.width > 0) {
            const next = clampGalleryPage(Math.round(event.currentTarget.scrollLeft / layout.width), layout.pageCount);
            const activeCard = document.activeElement?.closest<HTMLElement>("[data-guest-page]");
            if (activeCard && event.currentTarget.contains(activeCard) && Number(activeCard.dataset.guestPage) !== next) {
              event.currentTarget.focus({ preventScroll: true });
            }
            setPage(next);
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); goToPage(currentPage + 1); }
          if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); goToPage(currentPage - 1); }
          if (event.key === "Home") { event.preventDefault(); goToPage(0); }
          if (event.key === "End") { event.preventDefault(); goToPage(layout.pageCount - 1); }
        }}
        className="min-h-0 shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
        style={{ width: layout.width, height: layout.contentHeight, scrollSnapType: "x mandatory" }}
      >
        <div
          data-stage-mode={stageMode(tiles.length)}
          data-stage-count={tiles.length}
          className="relative"
          style={{ width: layout.width * layout.pageCount, height: layout.contentHeight }}
        >
          {Array.from({ length: layout.pageCount }, (_, index) => (
            <div key={`gallery-page:${index}`} aria-hidden="true" className="pointer-events-none absolute top-0" style={{ left: index * layout.width, width: layout.width, height: 1, scrollSnapAlign: "start" }} />
          ))}
          {tiles.map((tile) => {
            const focused = tile.key === focusedKey;
            const pinned = tile.key === pinnedKey;
            const position = focused ? { page: 0, left: 0, top: 0 }
              : guestGalleryPosition(guests.findIndex((guest) => guest.key === tile.key), layout);
            const style: CSSProperties = focused ? {
              position: "sticky", left: (layout.width - layout.host.width) / 2,
              marginLeft: (layout.width - layout.host.width) / 2, top: 0, zIndex: 10,
              width: layout.host.width, height: layout.host.height,
            } : {
              position: "absolute", left: position.left, top: layout.guestTop + position.top,
              width: layout.tileWidth, height: layout.tileHeight,
            };
            return (
              <div
                key={tile.key}
                data-stage-card={tile.key}
                data-focused={focused ? "true" : "false"}
                data-guest-page={focused ? undefined : position.page}
                inert={!focused && position.page !== currentPage ? true : undefined}
                aria-hidden={!focused && position.page !== currentPage ? true : undefined}
                className={`flex min-h-0 flex-col overflow-hidden rounded-2xl bg-[#0b0d14] ${pinned ? "ring-1 ring-inset ring-[#3FDCFF]/45" : ""}`}
                style={style}
              >
                <div className="min-h-0 flex-1"><StageTile tile={tile} /></div>
                {group ? (
                  <button
                    type="button"
                    aria-label={pinned ? `Unpin ${tile.name}` : `Focus ${tile.name}`}
                    aria-pressed={pinned}
                    aria-describedby={helpId}
                    title={pinned ? "Unpin and return to host view" : "Keep this person in focus · only for you"}
                    onClick={() => focus(pinned ? null : tile.key)}
                    className={`flex h-11 shrink-0 items-center justify-center gap-1.5 border-t border-white/5 px-2 text-[11px] font-semibold transition-colors motion-reduce:transition-none hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3FDCFF] ${pinned ? "bg-[#3FDCFF]/8 text-[#3FDCFF]" : "text-white/75"}`}
                  >
                    {pinned ? <PinOff size={13} aria-hidden="true" /> : <Pin size={13} aria-hidden="true" />}
                    {pinned ? "Pinned for you" : focused ? "In focus" : "Focus"}
                    {tile.isSpeaking ? <span className="truncate text-[#3FDCFF]">· Speaking</span> : null}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {group ? (
        <div className="flex shrink-0 items-center justify-between gap-1 text-xs text-white/70" style={{ width: layout.width, height: layout.footerHeight }}>
          <button type="button" aria-label="Previous guest page" disabled={currentPage === 0} onClick={() => goToPage(currentPage - 1)} className="flex h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3FDCFF]"><ChevronLeft size={18} aria-hidden="true" /></button>
          <span className="min-w-0 text-center leading-4">
            <span aria-live="polite" aria-atomic="true" className="block font-mono text-[11px] text-white/80">
              <span className="sr-only">Guests {visibleStart} to {visibleEnd} of {guests.length}. </span>
              {guests.length} guests · {currentPage + 1}/{layout.pageCount}
            </span>
            {layout.pageCount > 1 ? <span aria-hidden="true" className="block text-[10px] text-white/50">Swipe or use ← →</span> : null}
          </span>
          {pinnedKey ? <button type="button" onClick={() => focus(null)} className="min-h-11 shrink-0 rounded-lg px-2 text-[11px] text-[#3FDCFF] hover:bg-white/8 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3FDCFF]">Reset focus</button> : null}
          <button type="button" aria-label="Next guest page" disabled={currentPage >= layout.pageCount - 1} onClick={() => goToPage(currentPage + 1)} className="flex h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#3FDCFF]"><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      ) : null}
    </div>
  );
}
