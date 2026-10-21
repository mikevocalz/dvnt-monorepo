import { useRef } from "react";
import { resolveEventByPathSegment } from "../events/event-discovery";
import { usePublicEventIndex } from "./use-public-event-index";

/** Once opened, a title route holds its exact event until the URL changes. */
export function useEventTitleRoute(slug: string, enabled: boolean) {
  const index = usePublicEventIndex(enabled, slug);
  const opened = useRef<{ slug: string; id: string | number } | null>(null);
  if (!enabled || opened.current?.slug !== slug) opened.current = null;
  if (enabled && !opened.current && index.routingIndex) {
    const id = resolveEventByPathSegment(index.routingIndex, slug)?.id;
    if (id != null) opened.current = { slug, id };
  }
  // Idle expiry, a background refresh, or a new same-title event must neither
  // tear down the open screen nor silently switch it to a different event.
  return { ...index, resolvedTitleId: opened.current?.id };
}
