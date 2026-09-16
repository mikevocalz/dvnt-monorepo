import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@dvnt/app/lib/utils/storage";

/**
 * "Make this my first post" — offered once, then never again.
 *
 * `claimedCartId` pins the offer to the first admission purchase that reached
 * the confirmation screen, so a second cart opened before the member answers
 * cannot raise a second offer. `resolved` closes it for good once they accept
 * or skip. Skipping changes nothing about the ticket; it only stops the ask.
 *
 * `pendingEventId` is the thread from the draft to publication. The composer
 * can sit for days, so the event's visibility is rechecked against the server
 * at Post time rather than trusted from when the draft was built.
 *
 * ponytail: device-local. A reinstall or a second device forgets that the offer
 * was already spent and can ask once more. The ceiling is a server-side
 * "has this member ever bought admission" read, which no endpoint exposes today.
 */
interface FirstPostOfferState {
  claimedCartId: string | null;
  resolved: boolean;
  pendingEventId: number | null;
  /** Take the single offer for `cartId`. False when it is already spent. */
  claim: (cartId: string) => boolean;
  /** The member sent the draft to the composer. */
  accept: (eventId: number) => void;
  /** The member said no. The ticket is untouched either way. */
  skip: () => void;
  /** Drop the publication-time link — posted, discarded, or no longer public. */
  clearPending: () => void;
}

export const useFirstPostOfferStore = create<FirstPostOfferState>()(
  persist(
    (set, get) => ({
      claimedCartId: null,
      resolved: false,
      pendingEventId: null,
      claim: (cartId) => {
        const { resolved, claimedCartId } = get();
        if (resolved || !cartId) return false;
        if (claimedCartId && claimedCartId !== cartId) return false;
        if (!claimedCartId) set({ claimedCartId: cartId });
        return true;
      },
      accept: (eventId) => set({ resolved: true, pendingEventId: eventId }),
      skip: () => set({ resolved: true, pendingEventId: null }),
      clearPending: () => set({ pendingEventId: null }),
    }),
    {
      name: "first-post-offer-storage",
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        claimedCartId: state.claimedCartId,
        resolved: state.resolved,
        pendingEventId: state.pendingEventId,
      }),
    },
  ),
);
