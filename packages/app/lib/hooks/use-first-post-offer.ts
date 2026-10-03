import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MixedTicket } from "@dvnt/app/lib/contracts/dto";
import {
  buildFirstPostDraft,
  findAdmissionEventId,
} from "@dvnt/app/lib/posts/first-post-draft";
import { createTextPostSlide } from "@dvnt/app/lib/posts/text-post";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { useFirstPostOfferStore } from "@dvnt/app/lib/stores/first-post-offer-store";

export type FirstPostAcceptResult =
  | "applied"
  | "kept-existing"
  | "unavailable";

/** True when the composer already holds something a member typed. */
function composerHasDraft(): boolean {
  const draft = useCreatePostStore.getState();
  return (
    draft.selectedMedia.length > 0 ||
    draft.caption.trim().length > 0 ||
    draft.textSlides.some((slide) => slide.content.trim().length > 0)
  );
}

/**
 * Server-owned "Make this my first post" offer.
 *
 * The old implementation spent the opportunity in device-local Zustand. A
 * reinstall or second device could therefore receive the same "first" offer.
 * The server now proves the completed cart belongs to the caller, identifies
 * its real issued admission ticket, checks for an older admission + any
 * existing post, and claims one campaign row per Better Auth account.
 */
export function useFirstPostOffer(
  cartId: string,
  tickets: readonly MixedTicket[] | undefined,
) {
  const queryClient = useQueryClient();
  const acceptLocal = useFirstPostOfferStore((s) => s.accept);
  const skipLocal = useFirstPostOfferStore((s) => s.skip);
  const eventId = useMemo(() => findAdmissionEventId(tickets), [tickets]);

  const offerQuery = useQuery({
    queryKey: ["first-post-offer", cartId],
    queryFn: async () => {
      const { firstPostOfferApi } = await import("@dvnt/app/lib/api/first-post-offer");
      return firstPostOfferApi.resolve(cartId);
    },
    enabled: Boolean(cartId && eventId != null),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const draft = useMemo(
    () =>
      offerQuery.data?.offer?.event
        ? buildFirstPostDraft({
            event: offerQuery.data.offer.event,
            lines: tickets,
          })
        : null,
    [offerQuery.data?.offer, tickets],
  );

  const accept = useCallback(
    async (accepted: {
      eventId: number;
      content: string;
    }): Promise<FirstPostAcceptResult> => {
      // An in-progress draft is the member's, not ours to replace. Do not
      // consume the server offer until the composer is actually available.
      if (composerHasDraft()) return "kept-existing";

      const { firstPostOfferApi } = await import("@dvnt/app/lib/api/first-post-offer");
      const result = await firstPostOfferApi.accept();
      if (!result.offer || result.offer.state !== "accepted") {
        void queryClient.invalidateQueries({
          queryKey: ["first-post-offer", cartId],
        });
        return "unavailable";
      }

      const store = useCreatePostStore.getState();
      store.setPostKind("text");
      store.setTextTheme("deviant");
      store.setTextSlides([createTextPostSlide(accepted.content)]);
      store.setActiveTextSlideIndex(0);
      acceptLocal(accepted.eventId);
      queryClient.setQueryData(["first-post-offer", cartId], {
        ok: true,
        offer: null,
        reason: "accepted",
      });
      return "applied";
    },
    [acceptLocal, cartId, queryClient],
  );

  const skip = useCallback(async () => {
    try {
      const { firstPostOfferApi } = await import("@dvnt/app/lib/api/first-post-offer");
      await firstPostOfferApi.dismiss();
      skipLocal();
      queryClient.setQueryData(["first-post-offer", cartId], {
        ok: true,
        offer: null,
        reason: "dismissed",
      });
    } catch (error) {
      console.warn("[FirstPostOffer] Could not dismiss offer:", error);
    }
  }, [cartId, queryClient, skipLocal]);

  return {
    draft,
    accept,
    skip,
    isLoading: offerQuery.isLoading,
    error: offerQuery.error,
  };
}
