/**
 * Shared FIFO queue semantics and truthful copy for web and native.
 * Public aliases identify anonymous guests; departed members retain their
 * numbered position until dismissed. Local dismissal is not a peer-hand update.
 */
// Explicit extension: this module is exercised by `node --test`, whose ESM
// resolver requires it for a relative TS specifier. Metro and the Next build
// resolve it too, and every tsconfig that sees this file now sets
// `allowImportingTsExtensions` (all of them are noEmit). Dropping the `.ts`
// does not fail a typecheck — it fails `pnpm test:lynk-session` at RUNTIME,
// which is how it went unnoticed for a merge.
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

/** Local dismissal must not imply a server-side peer-hand change. */
export const HAND_QUEUE_COPY = {
  title: "Raised hands",
  empty: "Raised hands will show up here in the order they're raised.",
  invite: "Make co-host",
  lower: "Dismiss here",
  lowerAll: "Clear my queue",
  dismissalHint: "Dismissing only clears your view; it does not lower their hand.",
  departed: "Left the room",
} as const;
