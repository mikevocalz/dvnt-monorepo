/**
 * Which phone comp links the host has texted, for the comp sheet on both
 * platforms.
 *
 * In memory only, on purpose. A claim link is a live capability until it is
 * claimed, so it does not get written to MMKV or localStorage. A host who
 * closes the sheet before texting everyone comps the same numbers again: the
 * server rotates the link on the existing ticket and no seat is spent twice.
 */
import { create } from "zustand";
import type { CompClaimLink } from "@dvnt/app/lib/api/privileged";
import {
  compClaimMessage,
  continuesQueue,
  unsentLinks,
  type ClaimSendStatus,
} from "@dvnt/app/lib/tickets/comp-claim-message";
import {
  canTextAll,
  shareClaimLink,
  textClaimLink,
} from "@dvnt/app/lib/tickets/send-comp-claim";

interface CompClaimSendState {
  eventTitle: string | null;
  links: CompClaimLink[];
  statuses: Record<string, ClaimSendStatus>;
  /** ticket_id of the composer currently open, so only one is ever up. */
  active: string | null;
  load: (links: CompClaimLink[], eventTitle: string | null | undefined) => void;
  reset: () => void;
  text: (ticketId: string) => Promise<ClaimSendStatus | null>;
  share: (ticketId: string) => Promise<ClaimSendStatus | null>;
  /** One composer per person, in order. Stops when the host cancels one. */
  textAll: () => Promise<void>;
}

const EMPTY = { eventTitle: null, links: [], statuses: {}, active: null };

export const useCompClaimSendStore = create<CompClaimSendState>((set, get) => {
  const run = async (
    ticketId: string,
    send: typeof textClaimLink,
  ): Promise<ClaimSendStatus | null> => {
    const { links, active, eventTitle } = get();
    const link = links.find((l) => l.ticket_id === ticketId);
    if (!link || active) return null;
    set({ active: ticketId });
    let status: ClaimSendStatus = "failed";
    try {
      status = await send(link, compClaimMessage(eventTitle, link.url));
    } finally {
      set((s) => ({ active: null, statuses: { ...s.statuses, [ticketId]: status } }));
    }
    return status;
  };

  return {
    ...EMPTY,
    load: (links, eventTitle) =>
      set({ links, eventTitle: eventTitle ?? null, statuses: {}, active: null }),
    reset: () => set(EMPTY),
    text: (ticketId) => run(ticketId, textClaimLink),
    share: (ticketId) => run(ticketId, shareClaimLink),
    textAll: async () => {
      if (!canTextAll) return;
      for (const link of unsentLinks(get().links, get().statuses)) {
        const status = await run(link.ticket_id, textClaimLink);
        if (!status || !continuesQueue(status)) return;
      }
    },
  };
});
