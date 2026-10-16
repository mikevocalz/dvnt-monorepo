/**
 * Presence is a discovery hint, not an admission decision. Before joining,
 * membership RLS may hide every host row, so an open room can have isLive=false
 * even while its host is connected. Never turn that partial snapshot into a
 * terminal "Lynk Closed" screen.
 *
 * Prejoin only offers the Join button. video_join_room remains authoritative
 * for expiry, event waiting/access, invites, bans, verification and capacity;
 * no media is admitted here.
 */
export function getRoomEntryStatus(
  room: { status: "open" | "closed" | "ended" } | null,
): "unavailable" | "ended" | "prejoin" {
  if (!room) return "unavailable";
  return room.status === "ended" || room.status === "closed" ? "ended" : "prejoin";
}
