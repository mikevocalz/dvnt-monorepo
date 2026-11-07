/** Discovery is a snapshot. Only an explicit end or deadline closes admission. */
export function discoveryRoomState(room: {
  status?: "open" | "ended";
  isLive: boolean;
  endsAt?: string | null;
  presenceKnown?: boolean;
  listeners: number;
  maxParticipants?: number;
}, now = Date.now()) {
  const deadline = room.endsAt ? Date.parse(room.endsAt) : NaN;
  const ended = room.status === "ended" || (Number.isFinite(deadline) && deadline <= now);
  const live = !ended && room.isLive && room.presenceKnown !== false;
  const countKnown = room.presenceKnown !== false && (live || ended);
  return {
    ended,
    live,
    countKnown,
    full: live && !!room.maxParticipants && room.listeners >= room.maxParticipants,
    label: ended ? "Ended" : live ? "Live now" : "Open room",
  };
}
