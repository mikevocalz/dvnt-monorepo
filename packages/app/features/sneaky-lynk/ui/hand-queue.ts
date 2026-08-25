/**
 * Hand-queue behaviour, shared by both room legs.
 *
 * The two legs render different affordances on purpose — a bottom sheet on
 * native, a side panel on web — but the queue semantics, the available actions
 * and the words on the buttons are not platform decisions, and they had drifted
 * into three separate ones:
 *
 *   - web offered only "promote", so a host on web could invite someone up but
 *     could not lower a hand or clear the queue at all;
 *   - the same action was labelled "Bring up" on web and "Invite to speak" on
 *     native, so the product had two names for one thing;
 *   - web resolved the raiser's name with its own fallback chain, which is how
 *     anonymous participants ended up showing real names to the host.
 */
// Explicit extension: this module is exercised by `node --test`, whose ESM
// resolver requires it. Metro and the Next build both resolve it too.
import { getSneakyUserLabel } from "./user-labels.ts";

export interface HandRaiser {
  userId: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

export interface HandQueueEntry {
  userId: string;
  /** Anonymity-resolved. Never the real name of an anonymous raiser. */
  label: string;
  avatar?: string;
  isAnonymous: boolean;
  /** 1-based, oldest first — the host needs to know who is next. */
  position: number;
  /** Raised a hand, then left. Kept in place so the position numbers of the
   *  people still waiting do not shuffle under the host's finger. */
  departed: boolean;
}

/**
 * Join the FIFO id list against whoever is currently in the room. Order is the
 * source of truth; the roster only supplies detail.
 */
export function buildHandQueue(
  raisedHandOrder: readonly string[],
  raisers: readonly HandRaiser[],
): HandQueueEntry[] {
  const byId = new Map(raisers.map((r) => [r.userId, r]));
  const seen = new Set<string>();
  const queue: HandQueueEntry[] = [];

  for (const userId of raisedHandOrder) {
    // A duplicate id would render two rows for one person and make
    // "position 3 of 4" a lie.
    if (seen.has(userId)) continue;
    seen.add(userId);
    const raiser = byId.get(userId);
    queue.push({
      userId,
      label: raiser ? getSneakyUserLabel(raiser) : "Left the room",
      avatar: raiser?.isAnonymous ? undefined : raiser?.avatar,
      isAnonymous: !!raiser?.isAnonymous,
      position: queue.length + 1,
      departed: !raiser,
    });
  }

  return queue;
}

/** One set of words for both legs. */
export const HAND_QUEUE_COPY = {
  title: "Raised hands",
  /** An empty panel is a chance to explain the rule the host is about to rely
   *  on. Web's "No raised hands right now." only restated the emptiness. */
  empty: "Raised hands will show up here in the order they're raised.",
  /** Names what happens, not where it happens — "Bring up" described the
   *  layout, "Invite to speak" describes the outcome. */
  invite: "Invite to speak",
  lower: "Lower",
  /** "Lower all hands", not "Dismiss all": it matches the per-row action and
   *  cannot be misread as dismissing the panel. */
  lowerAll: "Lower all hands",
  departed: "Left the room",
} as const;
