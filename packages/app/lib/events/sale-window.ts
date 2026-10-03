/**
 * Ticket sale start/end in the event's zone.
 *
 * The create and edit forms hold a tier's sale start/end the same way they
 * hold the event start: as a device-local Date ISO whose fields are the wall
 * clock the organizer typed. These helpers convert at the edges, reusing
 * event-zone.ts, so "sales open 8:00 PM" on a Los Angeles event means 8:00 PM
 * Pacific whatever zone the organizer's device is in, and changing the event's
 * zone keeps the typed time, as it does for the event start.
 */

import { formatEventWhen } from "./event-time.ts";
import {
  deviceTimeZone,
  localIsoToZonedIso,
  normalizeTimeZone,
  zonedIsoToLocalIso,
} from "./event-zone.ts";

/** Form value -> stored instant (ISO), or null when blank or unparseable. */
export function saleWindowLocalToInstant(
  localIso: string | null | undefined,
  eventTz: string,
): string | null {
  if (!localIso) return null;
  return localIsoToZonedIso(localIso, eventTz) || null;
}

/** Stored instant -> form value, or "" when blank or unparseable. */
export function saleWindowInstantToLocal(
  instant: string | null | undefined,
  eventTz: string,
): string {
  if (!instant) return "";
  return zonedIsoToLocalIso(instant, eventTz);
}

/** "Fri, Jul 10 at 8:00 PM PDT" for a form value, "" when blank. */
export function saleWindowLabel(
  localIso: string | null | undefined,
  eventTz: string,
): string {
  const instant = saleWindowLocalToInstant(localIso, eventTz);
  if (!instant) return "";
  const zone = normalizeTimeZone(eventTz) ?? deviceTimeZone();
  return formatEventWhen(instant, { event_tz: zone });
}
