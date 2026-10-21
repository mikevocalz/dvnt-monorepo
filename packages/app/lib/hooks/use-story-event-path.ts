import { usePublicEventIndex } from "./use-public-event-index";
import { storyEventDetailRoute } from "../events/event-detail-route";

/** A stored story title is a snapshot, not a trustworthy current destination. */
export function useStoryEventPath(eventId: string | undefined) {
  const validId = eventId && /^[1-9]\d*$/.test(eventId) && Number.isSafeInteger(Number(eventId))
    ? eventId
    : undefined;
  const index = usePublicEventIndex(!!validId, validId);
  return validId
    ? storyEventDetailRoute(validId, index.routingIndex)
    : undefined;
}
