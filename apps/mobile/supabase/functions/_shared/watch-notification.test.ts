import { watchNotificationFields, watchNotificationImage } from "./watch-notification.ts";
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
Deno.test("collapse identities stay bounded and promoted offers are time sensitive", () => {
  const message = watchNotificationFields("message", { conversationId: "82" });
  if (message.collapseId !== "dm.82" || message.tag !== "dm.82") throw new Error("missing collapse mapping");
  if (watchNotificationFields("message", { conversationId: "x".repeat(70) }).collapseId) throw new Error("unbounded collapse identity");
  const offer = watchNotificationFields("event_waitlist_promoted", { entityType: "event", entityId: 9 });
  if (offer.categoryId !== "DVNT_WAITLIST" || offer.threadId !== "event.9" || offer.interruptionLevel !== "time-sensitive") throw new Error("offer presentation");
  const date = "2026-09-05T21:00:00Z";
  if (watchNotificationFields("event_update", { eventId: 9, eventStartAt: date }, Date.parse(date)).interruptionLevel !== "time-sensitive") throw new Error("event-day priority");
});

Deno.test("notification image only uses authorized message CDN image and preserves signed URL", () => {
  if (Object.keys(watchNotificationImage({ mediaType: "image", mediaUrl: "https://untrusted.example/image.jpg" })).length) throw new Error("foreign origin");
  if (Object.keys(watchNotificationImage({ mediaType: "video", mediaUrl: "https://dvnt.b-cdn.net/video.mp4" })).length) throw new Error("video image");
  const image = watchNotificationImage({ mediaItems: [{ type: "image", uri: "https://dvnt.b-cdn.net/p.jpg" }] });
  if (image.richContent?.image !== "https://dvnt.b-cdn.net/p.jpg?width=256" || !image.mutableContent) throw new Error("missing rendition");
  const signed = "https://dvnt.b-cdn.net/p.jpg?token=opaque&expires=1";
  if (watchNotificationImage({ mediaType: "image", mediaUrl: signed }).richContent?.image !== signed) throw new Error("signed URL changed");
});
