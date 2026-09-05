/** Expo Push Service fields, verified against its documented APNs/FCM mapping. */
export function watchNotificationFields(type: string, data: Record<string, unknown> = {}, now = Date.now()) {
  const id = (key: string) => typeof data[key] === "string" || typeof data[key] === "number" ? String(data[key]) : undefined;
  const eventId = id("eventId") ?? (data.entityType === "event" ? id("entityId") : undefined);
  const group = (prefix: string, value?: string) => value && /^[a-zA-Z0-9_-]{1,48}$/.test(value) ? `${prefix}.${value}` : undefined;
  const eventGroup = group("event", eventId);
  const eventTime = typeof data.eventStartAt === "string" ? Date.parse(data.eventStartAt) : NaN;
  const eventDay = Number.isFinite(eventTime) && Math.abs(eventTime - now) <= 24 * 3600_000;
  if (type === "message" || type === "dm") {
    const key = group("dm", id("conversationId"));
    return { categoryId: "DVNT_MESSAGE", threadId: key, collapseId: key, tag: key, interruptionLevel: "active" as const };
  }
  if (type === "call") {
    const key = group("call", id("roomId") ?? id("callId"));
    return { categoryId: "DVNT_CALL", threadId: key, collapseId: key, tag: key, interruptionLevel: "time-sensitive" as const };
  }
  if (type === "event_waitlist_promoted") return { categoryId: "DVNT_WAITLIST", threadId: eventGroup, collapseId: group("waitlist", eventId), interruptionLevel: "time-sensitive" as const };
  if (type === "event_host" || type === "host_door") return { categoryId: "DVNT_HOST", threadId: eventGroup, collapseId: group("host", eventId), interruptionLevel: "active" as const };
  if (type === "ticket" || type.startsWith("ticket_")) return { categoryId: "DVNT_TICKET", threadId: eventGroup, collapseId: group("ticket", id("ticketId")), interruptionLevel: eventDay ? "time-sensitive" as const : "active" as const };
  if (type === "event" || type.startsWith("event_")) return { categoryId: "DVNT_EVENT", threadId: eventGroup, collapseId: eventGroup, interruptionLevel: eventDay ? "time-sensitive" as const : "active" as const };
  return { interruptionLevel: "active" as const };
}

/** Used only after sender/recipient membership and block checks, on stored message media. */
export function watchNotificationImage(metadata: Record<string, unknown> | null | undefined): { richContent: { image: string }; mutableContent: true } | Record<string, never> {
  const media = Array.isArray(metadata?.mediaItems) ? metadata.mediaItems : [];
  const first = media.find((item: any) => item?.type === "image") as { uri?: unknown } | undefined;
  const candidate = first?.uri ?? (metadata?.mediaType === "image" ? metadata.mediaUrl : undefined);
  if (typeof candidate !== "string") return {};
  try {
    const url = new URL(candidate);
    // Never instruct a background extension to fetch sender-supplied arbitrary origins.
    if (url.protocol !== "https:" || url.hostname !== "dvnt.b-cdn.net" || url.username || url.password || url.port) return {};
    // Signed URLs must remain byte-identical; mutating their query would break authorization.
    if (!url.searchParams.has("token") && !url.searchParams.has("signature")) url.searchParams.set("width", "256");
    return { richContent: { image: url.toString() }, mutableContent: true };
  } catch { return {}; }
}
