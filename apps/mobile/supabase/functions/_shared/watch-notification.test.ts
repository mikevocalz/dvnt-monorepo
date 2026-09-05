import { watchNotificationFields } from "./watch-notification.ts";
Deno.test("message category groups canonical conversation without critical delivery", () => {
  const result = watchNotificationFields("message", { conversationId: "82" });
  if (result.categoryId !== "DVNT_MESSAGE" || result.threadId !== "dm.82" || result.interruptionLevel !== "active") throw new Error("bad message presentation");
});
Deno.test("event and ticket share grouping, call separate time-sensitive category", () => {
  if (watchNotificationFields("event_broadcast", { eventId: 4 }).threadId !== watchNotificationFields("ticket", { eventId: 4 }).threadId) throw new Error("event grouping split");
  const call = watchNotificationFields("call", { roomId: "room" });
  if (call.categoryId !== "DVNT_CALL" || call.threadId !== "call.room" || call.interruptionLevel !== "time-sensitive") throw new Error("call presentation");
  if (watchNotificationFields("like").categoryId !== undefined) throw new Error("unrelated activity captured");
});
