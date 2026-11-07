/** Room IDs are opaque UUIDs/slugs, never a route or a query string. */
export function normalizeLynkRoomId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !/[^A-Za-z0-9_-]/.test(value)
    ? value
    : null;
}

function shareableRoomId(value: unknown): string | null {
  const id = normalizeLynkRoomId(value);
  // These are device-local practice spaces, not rooms another person can join.
  return id && id !== "my-room" && !id.startsWith("space-") ? id : null;
}

/** Share only the room identity. Links cannot grant access or media consent. */
export function lynkRoomShareUrl(value: unknown): string | null {
  const id = shareableRoomId(value);
  return id ? `https://dvntapp.live/sneaky-lynk/room/${encodeURIComponent(id)}` : null;
}

/** App-only fallback retains the same room instead of opening the app root. */
export function lynkRoomAppUrl(value: unknown): string | null {
  const id = shareableRoomId(value);
  return id ? `dvnt://sneaky-lynk/room/${encodeURIComponent(id)}` : null;
}
