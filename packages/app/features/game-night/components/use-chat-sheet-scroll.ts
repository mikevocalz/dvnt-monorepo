/**
 * Scroll + unread state for the game-night table chat sheet.
 *
 * The BottomSheet unmounts its children while closed, so the message list
 * element only exists while the sheet is open. Any scroll-to-bottom that runs
 * while closed (initial page load, live inserts) hits a null ref, and the
 * reopened list would start at scrollTop 0, the oldest message. On every open
 * this hook scrolls the freshly mounted list to the newest message before
 * paint and resets atBottom, the new-message pill and the unread count.
 *
 * Messages that arrive while the sheet is closed count as unread (except the
 * viewer's own) so the floating Chat button can show a badge.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Pixels from the bottom that still count as "at the newest message". */
const AT_BOTTOM_SLOP_PX = 40;

export function useChatSheetScroll(open: boolean) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const [showNewPill, setShowNewPill] = useState(false);
  const [unread, setUnread] = useState(0);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Runs after the sheet's children (and listRef) are committed, before paint.
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    atBottom.current = true;
    setShowNewPill(false);
    setUnread(0);
    scrollToBottom();
  }, [open, scrollToBottom]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_SLOP_PX;
    if (atBottom.current) setShowNewPill(false);
  }, []);

  /**
   * Call once per live message, after it has been added to the rows.
   * `listed` is false for rows the list does not show (reactions).
   */
  const noteIncoming = useCallback(
    (msg: { fromMe: boolean; listed: boolean }) => {
      if (!msg.listed) return;
      if (!openRef.current) {
        if (!msg.fromMe) setUnread((n) => n + 1);
        return;
      }
      if (atBottom.current) requestAnimationFrame(scrollToBottom);
      else setShowNewPill(true);
    },
    [scrollToBottom],
  );

  const jumpToNewest = useCallback(() => {
    scrollToBottom();
    atBottom.current = true;
    setShowNewPill(false);
  }, [scrollToBottom]);

  return {
    listRef,
    onScroll,
    scrollToBottom,
    showNewPill,
    unread,
    noteIncoming,
    jumpToNewest,
  };
}
