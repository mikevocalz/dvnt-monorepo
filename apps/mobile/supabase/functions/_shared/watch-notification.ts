/** Expo Push API wire names; ordinary messages never request critical delivery. */
export function watchNotificationFields(type: string, data: Record<string, unknown> = {}) {
  const id = (key: string) => typeof data[key] === "string" || typeof data[key] === "number" ? String(data[key]) : undefined;
  if (type === "message" || type === "dm") return {
    categoryId: "DVNT_MESSAGE", threadId: id("conversationId") ? `dm.${id("conversationId")}` : undefined,
    interruptionLevel: "active" as const,
  };
  if (type === "call") return { categoryId: "DVNT_CALL", threadId: id("roomId") ? `call.${id("roomId")}` : undefined, interruptionLevel: "time-sensitive" as const };
  if (type === "ticket" || type.startsWith("ticket_")) return { categoryId: "DVNT_TICKET", threadId: id("eventId") ? `event.${id("eventId")}` : undefined, interruptionLevel: "active" as const };
  if (type === "event" || type.startsWith("event_")) return { categoryId: "DVNT_EVENT", threadId: id("eventId") ? `event.${id("eventId")}` : undefined, interruptionLevel: "active" as const };
  return { interruptionLevel: "active" as const };
}
