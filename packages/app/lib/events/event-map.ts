import { isPubliclyListableEvent } from "./event-discovery.ts";

/** Fresh, narrowly selected public metadata, not a cached detail/attendee row. */
export interface EventMapLocation {
  id: string | number;
  title: string;
  visibility: string | null;
  is_hidden: boolean | null;
  publish_at: string | null;
  status: string | null;
  is_online: boolean | null;
  location_type: string | null;
  location: string | null;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
}

export interface EventMapPin {
  id: string;
  title: string;
  location: string;
  latitude: number;
  longitude: number;
}

/** No geocoding, device location, attendee data, or event-ID coordinate cache. */
export function eventMapPins(
  rows: readonly EventMapLocation[],
  visibleIds: readonly string[],
  now = Date.now(),
): EventMapPin[] {
  const allowed = new Set(visibleIds);
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const id = String(row.id);
    // Fail closed on a partial payload. These fields must come from the current
    // public-only query, not an old list row whose projection omitted policy.
    if (!allowed.has(id) || seen.has(id) ||
      ![null, "public"].includes(row.visibility) ||
      ![null, false].includes(row.is_hidden) ||
      row.publish_at === undefined || ![null, "active", "postponed"].includes(row.status) ||
      ![null, false].includes(row.is_online) ||
      row.location_type === undefined || row.location_type === "virtual" ||
      !isPubliclyListableEvent(row, now)) return [];
    const lat = row.location_lat;
    const lng = row.location_lng;
    if (typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return [];
    seen.add(id);
    return [{ id, title: row.title || "Event", location: row.location_name || row.location || "Venue location", latitude: lat, longitude: lng }];
  });
}

/** Stable numeric IDs only. Title slugs can collide and open a different event. */
export function eventMapIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0))].sort();
}

/** Reuse event-detail.web.tsx's existing single-venue Google embed protocol. */
export function eventMapEmbedUrl(pin: EventMapPin): string {
  return `https://maps.google.com/maps?q=${pin.latitude},${pin.longitude}&z=15&output=embed`;
}
export function eventMapDirectionsUrl(pin: EventMapPin): string {
  return `https://maps.google.com/?q=${pin.latitude},${pin.longitude}`;
}

/** List policies can revoke admission, never grant it without fresh metadata. */
export function eventListAllowsMap(event: {
  visibility?: unknown; status?: unknown; isHidden?: boolean;
  isOnline?: boolean; publishAt?: string | null;
}, now = Date.now()): boolean {
  return (event.visibility == null || event.visibility === "public") &&
    !event.isHidden && !event.isOnline &&
    (event.status == null || event.status === "active" || event.status === "postponed") &&
    (!event.publishAt || (Number.isFinite(Date.parse(event.publishAt)) && Date.parse(event.publishAt) <= now));
}
