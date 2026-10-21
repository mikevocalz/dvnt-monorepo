import { isEventShareToken, isPubliclyListableEvent, resolveEventByPathSegment, type DiscoveryEvent } from "./event-discovery.ts";
import { slugify } from "../slug.ts";

/** Internal event cards carry stable IDs, not the title slugs used by /events. */
export function webEventDetailRoute(id: string | number): string {
  return `/feed/events/${encodeURIComponent(String(id))}`;
}

/** Prefer the current canonical title only when it unambiguously identifies this ID. */
export function storyEventDetailRoute(id: string, index?: DiscoveryEvent[]): string {
  const fallback = webEventDetailRoute(id);
  const source = index?.find((event) => String(event.id) === id);
  if (!source?.title?.trim() || !isPubliclyListableEvent(source)) return fallback;
  const slug = slugify(source.title);
  if (isEventShareToken(slug)) return fallback;
  const matches = index!.filter((event) =>
    isPubliclyListableEvent(event) && slugify(event.title) === slug,
  );
  return matches.length === 1 ? `/events/${slug}` : fallback;
}

/** Title routes must not resolve against a partial or stale upcoming-event list. */
export function resolveEventDetailId({ directId, slug, tokenId, titleId, listEvent, index }: {
  directId?: number;
  slug: string;
  tokenId?: number;
  titleId?: string | number;
  listEvent?: DiscoveryEvent;
  index?: DiscoveryEvent[];
}) {
  if (directId !== undefined) return directId;
  if (isEventShareToken(slug)) return tokenId ?? listEvent?.id ?? undefined;
  return titleId ?? resolveEventByPathSegment(index, slug)?.id;
}

export function matchingEventDetailPreview<T extends DiscoveryEvent>(
  event: T | undefined,
  resolvedId: string | number | null | undefined,
): T | undefined {
  return resolvedId != null && String(event?.id) === String(resolvedId) ? event : undefined;
}
