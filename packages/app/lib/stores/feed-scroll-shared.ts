/**
 * The feed's live scroll offset, as a Reanimated shared value.
 *
 * The stories row and the feed are SIBLINGS in `(tabs)/index.tsx` — the row is
 * deliberately outside the list so it survives feed-mode toggles without
 * remounting. That means the row cannot read the list's scroll position through
 * props or context without re-rendering on every frame, which is exactly what
 * you must not do to a horizontally scrollable strip of images.
 *
 * `makeMutable` gives both sides one value that lives on the UI thread: the
 * feeds write it from their scroll handler, the stories row reads it inside a
 * worklet. No React state, no re-renders, no dropped frames.
 *
 * ponytail: a module singleton, not a provider. There is exactly one feed on
 * screen at a time; a second one would need this scoped, and nothing is asking
 * for that.
 */

import { makeMutable } from "react-native-reanimated";

/** Vertical content offset of whichever feed is mounted. Never negative. */
export const feedScrollY = makeMutable(0);

/** Reset to expanded — call when a feed mounts or scrolls itself to the top. */
export function resetFeedScroll(): void {
  feedScrollY.value = 0;
}
