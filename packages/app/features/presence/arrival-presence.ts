/**
 * Host & Guest WS-5 — arrival presence.
 *
 * The single law this file exists to enforce: **coordinates never leave the
 * device.** The phone asks where it is, compares that to the venue locally, and
 * reports a WORD — `approaching` | `arrived` | `departed`. Nothing in the
 * payload can be reverse-engineered into a position, because the payload has no
 * numbers in it.
 *
 * Per Mike's Phase-0 answer this is a ONE-SHOT check in a radius, not a
 * geofence. That matters more than it sounds: it reuses the existing foreground
 * `getCurrentPositionAsync` in `use-device-location.ts`, so there is **no new
 * permission, no background mode, no `Always` authorization, and nothing to
 * justify to App Review**. A guest with the app closed simply doesn't report —
 * they arrive and scan like anyone else, and the door is the truth regardless.
 *
 * Consent is per-event, off by default, and revocable; revoking deletes the
 * row server-side immediately.
 */

import * as Location from "expo-location";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

export type PresenceState = "approaching" | "arrived" | "departed";

/** Metres. Coarse on purpose — this stages a line, it does not track anyone. */
export const ARRIVED_RADIUS_M = 75;
export const APPROACHING_RADIUS_M = 500;

/**
 * Great-circle distance in metres. Equirectangular is accurate to well under a
 * metre at these ranges and costs a fraction of haversine — and the whole point
 * is that this runs on-device, cheaply, once.
 */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const x = (b.lng - a.lng) * toRad * Math.cos(((a.lat + b.lat) / 2) * toRad);
  const y = (b.lat - a.lat) * toRad;
  return Math.sqrt(x * x + y * y) * R;
}

/**
 * Distance → state. Pure, so it is testable without a device and without a
 * network — the boundary behaviour is the part that decides whether a host's
 * "18 arrived" is a lie.
 */
export function stateForDistance(metres: number): PresenceState {
  if (metres <= ARRIVED_RADIUS_M) return "arrived";
  if (metres <= APPROACHING_RADIUS_M) return "approaching";
  return "departed";
}

/**
 * Take one reading and report the resulting state.
 *
 * Returns the state posted, or null when nothing was posted — which is the
 * common case and never an error: no consent, no venue coordinates, permission
 * not granted, or the app simply isn't in the foreground.
 *
 * Deliberately does NOT request permission. It only uses an authorization the
 * member has already given for the "Near Me" events filter; presence must never
 * be the reason a permission dialog appears.
 */
export async function reportArrivalOnce(params: {
  eventId: string;
  ticketId: string;
  venue: { lat: number; lng: number } | null;
  consented: boolean;
}): Promise<PresenceState | null> {
  const { eventId, ticketId, venue, consented } = params;
  if (!consented || !venue) return null;

  try {
    // Existing authorization only — never a fresh prompt from here.
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const state = stateForDistance(
      distanceMetres(
        { lat: pos.coords.latitude, lng: pos.coords.longitude },
        venue,
      ),
    );

    // The word, and only the word. No coords, no accuracy, no timestamp of the
    // reading itself — the server stamps its own.
    const { error } = await invokeEdge("event-presence", {
      action: "report",
      event_id: eventId,
      ticket_id: ticketId,
      state,
    });
    return error ? null : state;
  } catch {
    // Presence is an accelerator for the door, never a blocker. A failed
    // reading is silence, not an error surfaced to the member.
    return null;
  }
}

/** Revoke consent: deletes this member's presence for the event, immediately. */
export async function revokeArrivalPresence(params: {
  eventId: string;
  ticketId: string;
}): Promise<boolean> {
  const { error } = await invokeEdge("event-presence", {
    action: "revoke",
    event_id: params.eventId,
    ticket_id: params.ticketId,
  });
  return !error;
}
