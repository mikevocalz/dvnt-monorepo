/**
 * Hide an event, or schedule when it goes public (E06).
 *
 * events.is_hidden and events.publish_at (20261003110000). The server decides
 * who can see the event; this file holds the client half: the same validation
 * create-event applies, and the badge a host sees on their own event.
 */

import { formatEventWhen } from "./event-time.ts";
import { isPublishedEvent } from "./event-discovery.ts";
import { localIsoToZonedIso, zonedIsoToLocalIso } from "./event-zone.ts";

/** Same wording as create-event, so both refusals read the same. */
export const PUBLISH_AFTER_START_ERROR = "Set the go-public time before the event starts.";

/** null when the go-public time is usable (or unset). */
export function publishAtError(
  publishAtIso: string | null | undefined,
  startIso: string | null | undefined,
): string | null {
  if (!publishAtIso) return null;
  const at = Date.parse(publishAtIso);
  if (!Number.isFinite(at)) return "Go-public time is not a valid date";
  const start = Date.parse(startIso ?? "");
  if (Number.isFinite(start) && at > start) return PUBLISH_AFTER_START_ERROR;
  return null;
}

export interface PublicationFields {
  is_hidden?: boolean | null;
  isHidden?: boolean | null;
  publish_at?: string | null;
  publishAt?: string | null;
  event_tz?: string | null;
  eventTz?: string | null;
}

/**
 * "Hidden", "Goes public Sun, Oct 4 at 8:00 PM PDT", or null when the event is
 * already public. Shown to the host only; everyone else never sees the event.
 */
export function publicationBadge(
  event: PublicationFields | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!event) return null;
  const is_hidden = event.is_hidden ?? event.isHidden ?? false;
  const publish_at = event.publish_at ?? event.publishAt ?? null;
  if (is_hidden) return "Hidden";
  if (isPublishedEvent({ is_hidden, publish_at }, now)) return null;
  const when = formatEventWhen(publish_at, { event_tz: event.event_tz ?? event.eventTz ?? null });
  return when ? `Goes public ${when}` : "Not public yet";
}

/**
 * The forms hold "Go public at" the way they hold the event start: a
 * device-local Date ISO whose fields are the typed wall clock. These convert
 * it to and from the stored instant in the event's zone.
 */
export function publishAtLocalToInstant(
  localIso: string | null | undefined,
  eventTz: string,
): string | null {
  if (!localIso) return null;
  return localIsoToZonedIso(localIso, eventTz) || null;
}

export function publishAtInstantToLocal(
  instant: string | null | undefined,
  eventTz: string,
): string {
  if (!instant) return "";
  return zonedIsoToLocalIso(instant, eventTz);
}
