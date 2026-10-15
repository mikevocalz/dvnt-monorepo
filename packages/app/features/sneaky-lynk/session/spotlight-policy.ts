/**
 * Room-wide host spotlight permission contract; intentionally separate from
 * stores/pin-store.ts, which is a PRIVATE per-viewer layout preference.
 *
 * No client-side decision can authorize the actual broadcast. Server events
 * must confirm the acting role and active membership before being emitted.
 */
export type RoomRole = "host" | "co-host" | "speaker" | "participant" | "listener";
export type SpotlightChange =
  | { type: "set"; participantHandle: string }
  | { type: "clear" };

export interface SpotlightActor {
  role: RoomRole;
  status: "active" | "left" | "kicked" | "banned";
}
export interface HostSpotlight {
  roomId: string;
  participantHandle: string | null;
  revision: number;
}
export function mayChangeHostSpotlight(actor: SpotlightActor): boolean {
  return actor.status === "active" && (actor.role === "host" || actor.role === "co-host");
}
export function isValidSpotlightHandle(handle: string): boolean {
  // Handles from the existing anonymous roster are opaque. Do not resolve to
  // Better Auth ids in the browser or leak them in analytics.
  return Boolean(handle) && handle.length <= 128 &&
    (handle.startsWith("member:") ? /^member:[1-9][0-9]{0,9}$/.test(handle) : !/\s/.test(handle));
}
export function applyServerSpotlight(
  current: HostSpotlight, next: HostSpotlight,
): HostSpotlight {
  // Never accept an old event from a former room/session after reconnect.
  if (next.roomId !== current.roomId || next.revision <= current.revision) return current;
  if (next.participantHandle !== null && !isValidSpotlightHandle(next.participantHandle)) return current;
  return next;
}
export function requestSpotlight(
  actor: SpotlightActor, change: SpotlightChange,
): { accepted: boolean; reason?: string } {
  if (!mayChangeHostSpotlight(actor)) return { accepted:false, reason:"host_role_required" };
  if (change.type === "set" && !isValidSpotlightHandle(change.participantHandle)) {
    return { accepted:false, reason:"invalid_participant" };
  }
  return { accepted:true };
}
