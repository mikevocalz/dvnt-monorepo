"use client";

/**
 * Keep your place when you come back.
 *
 * The browser restores scroll on Back — for the WINDOW. Every long screen here
 * scrolls an inner `overflow-y-auto` div instead (the feed's scroller is pulled
 * up under the glass header, which is why it has to own the scroll), and the
 * window never moves. So Back always landed at the top: open a post from 40
 * rows down, come back, start again.
 *
 * Position is stored per key in sessionStorage — it should survive Back inside
 * a tab and die with the tab, which is exactly what sessionStorage does.
 *
 * Restoring is the hard half: the list is async, so at mount the scroller is a
 * few hundred pixels tall and setting scrollTop to 4000 silently clamps to the
 * bottom of nothing. We retry for a short window until the content is tall
 * enough to hold the offset, then stop.
 */

import { useEffect, type RefObject } from "react";

const PREFIX = "dvnt:scroll:";
/** ~2s at 60fps. Long enough for a feed page to land, short enough to give up. */
const MAX_RESTORE_FRAMES = 120;

function read(key: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.sessionStorage.getItem(PREFIX + key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Window-scrolling screens need this too. The browser does restore window
 * scroll on Back — but it does it before an async list has rendered, so on a
 * feed-shaped screen it restores to a page that is 600px tall and gives up.
 * Same retry, same storage, `scrollingElement` instead of a div.
 */
export function useWindowScrollRestoration(key: string, enabled = true) {
  const ref = {
    get current() {
      return typeof document === "undefined"
        ? null
        : (document.scrollingElement as HTMLElement | null);
    },
  } as RefObject<HTMLElement | null>;
  useScrollRestoration(ref, key, enabled, true);
}

export function useScrollRestoration(
  ref: RefObject<HTMLElement | null>,
  key: string,
  /** False while the screen has nothing to scroll yet (initial load). */
  enabled = true,
  /** Listen on window rather than the element (document scrolling). */
  onWindow = false,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !key) return;
    const scrollTarget: HTMLElement | Window = onWindow ? window : el;

    let frame = 0;
    let frames = 0;
    let restored = false;
    const target = read(key);

    // Restore first, and keep trying while the content grows into the offset.
    if (target > 0) {
      const attempt = () => {
        const node = ref.current;
        if (!node) return;
        const max = node.scrollHeight - node.clientHeight;
        if (max >= target) {
          node.scrollTop = target;
          restored = true;
          return;
        }
        // Take what we can get on the way — a partial restore beats the top.
        if (max > 0) node.scrollTop = max;
        if (++frames < MAX_RESTORE_FRAMES) frame = requestAnimationFrame(attempt);
      };
      frame = requestAnimationFrame(attempt);
    }

    let writeFrame = 0;
    const onScroll = () => {
      if (writeFrame) return;
      writeFrame = requestAnimationFrame(() => {
        writeFrame = 0;
        const node = ref.current;
        if (!node) return;
        // Ignore the clamped 0s the browser reports while a restore is still
        // in flight, or leaving the screen would overwrite the saved position
        // with the top of a half-loaded list.
        if (!restored && target > 0 && node.scrollTop === 0) return;
        window.sessionStorage.setItem(PREFIX + key, String(node.scrollTop));
      });
    };

    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollTarget.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (writeFrame) cancelAnimationFrame(writeFrame);
    };
  }, [ref, key, enabled, onWindow]);
}
