import { useCallback, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MixedTicket } from "@dvnt/app/lib/contracts/dto";
import {
  buildFirstPostDraft,
  findAdmissionEventId,
} from "@dvnt/app/lib/posts/first-post-draft";
import { fetchFirstPostEvent } from "@dvnt/app/lib/posts/first-post-event";
import { createTextPostSlide } from "@dvnt/app/lib/posts/text-post";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import { useFirstPostOfferStore } from "@dvnt/app/lib/stores/first-post-offer-store";

export type FirstPostAcceptResult = "applied" | "kept-existing";

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
 * The optional "Make this my first post" offer on the confirmed-purchase
 * screen. Shared by the native and web success screens; each one owns its own
 * navigation and its own chrome.
 *
 * `draft` is null unless every rule holds: an admission line in this cart, no
 * offer spent before, and an event the server currently reports as public.
 * Nothing here posts anything — accepting only fills the composer.
 */
export function useFirstPostOffer(
  cartId: string,
  tickets: readonly MixedTicket[] | undefined,
) {
  const resolved = useFirstPostOfferStore((s) => s.resolved);
  const claimedCartId = useFirstPostOfferStore((s) => s.claimedCartId);
  const claim = useFirstPostOfferStore((s) => s.claim);
  const acceptOffer = useFirstPostOfferStore((s) => s.accept);
  const skipOffer = useFirstPostOfferStore((s) => s.skip);

  const eventId = useMemo(() => findAdmissionEventId(tickets), [tickets]);

  const offerable =
    !resolved &&
    eventId != null &&
    !!cartId &&
    (!claimedCartId || claimedCartId === cartId);

  useEffect(() => {
    if (offerable) claim(cartId);
  }, [claim, cartId, offerable]);

  const eventQuery = useQuery({
    queryKey: ["first-post-event", eventId],
    queryFn: () => fetchFirstPostEvent(eventId as number),
    enabled: offerable,
    staleTime: 60_000,
  });

  const draft = useMemo(
    () =>
      offerable
        ? buildFirstPostDraft({ event: eventQuery.data, lines: tickets })
        : null,
    [eventQuery.data, offerable, tickets],
  );

  const accept = useCallback(
    (accepted: { eventId: number; content: string }): FirstPostAcceptResult => {
      // An in-progress draft is the member's, not ours to replace.
      if (composerHasDraft()) return "kept-existing";
      const store = useCreatePostStore.getState();
      store.setPostKind("text");
      store.setTextTheme("deviant");
      store.setTextSlides([createTextPostSlide(accepted.content)]);
      store.setActiveTextSlideIndex(0);
      acceptOffer(accepted.eventId);
      return "applied";
    },
    [acceptOffer],
  );

  return { draft, accept, skip: skipOffer };
}
