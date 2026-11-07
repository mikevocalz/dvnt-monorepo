/** A confirmed server identifier is required before entering a newly created room. */
export function resolveCreatedRoomId(room: unknown): string {
  if (!room || typeof room !== "object") return "";
  const candidate = room as { id?: unknown; uuid?: unknown; internalId?: unknown };
  const ids = [candidate.uuid, candidate.id, candidate.internalId]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String);
  return ids.find((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    ?? ids.find((id) => /^[1-9]\d*$/.test(id))
    ?? "";
}

/** IDs sent to the existing private-room invitation API, never public rooms. */
export function roomInviteeIds(isPublic: boolean, invitees: ReadonlyArray<{ authId: string }>): string[] {
  return isPublic ? [] : [...new Set(invitees.map((invitee) => invitee.authId).filter(Boolean))];
}
