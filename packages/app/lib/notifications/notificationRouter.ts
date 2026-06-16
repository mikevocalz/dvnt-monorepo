/**
 * Notification Router — DVNT
 *
 * Single source of truth for converting a push notification payload into an
 * Expo Router path.  All notification taps — cold-start AND warm-launch —
 * must go through this function.  Never hand-roll router.push paths in
 * notification listeners.
 *
 * Resolution order:
 *   1. data.url  (canonical HTTPS share link)  → parsed through the Link Engine
 *   2. data.deepLink  (dvnt:// custom scheme)   → parsed through the Link Engine
 *   3. Typed payload fields (data.type + entity IDs)  → direct path construction
 *
 * Returns null when the payload carries no actionable route (e.g. bare alerts).
 */

import { parseIncomingUrl } from "@dvnt/app/lib/deep-linking/link-engine";

// ── Supported notification payload types ──────────────────────────────────────

export type NotificationPayloadType =
  | "follow"
  | "follow_request"
  | "like"
  | "comment"
  | "mention"
  | "tag"
  | "message"
  | "dm"
  | "event"
  | "event_invite"
  | "event_update"
  | "sneaky_lynk"
  | "room_invite"
  | "call"
  | "ticket"
  | "post";

export interface NotificationData {
  type?: string;
  // Canonical URL — always preferred
  url?: string;
  deepLink?: string;
  // Typed entity IDs
  conversationId?: string;
  senderUserId?: string;
  senderId?: string;
  senderUsername?: string;
  actorUserId?: string;
  actorUsername?: string;
  userId?: string;
  eventId?: string;
  roomId?: string;
  postId?: string;
  commentId?: string;
  entityId?: string;
  entityType?: string;
  // Extra
  [key: string]: unknown;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve a notification payload data object into an Expo Router path string.
 * Returns null when no actionable route can be determined.
 */
export function routeFromNotification(
  data: NotificationData | null | undefined,
): string | null {
  if (!data) return null;

  // 1. Canonical URL wins — run through Link Engine so we get the same
  //    parsing/auth-gating as any other deep link.
  const canonicalUrl = data.url || data.deepLink;
  if (canonicalUrl && typeof canonicalUrl === "string") {
    const parsed = parseIncomingUrl(canonicalUrl);
    if (parsed?.routerPath) {
      console.log(
        "[NotificationRouter] Resolved via canonical URL:",
        parsed.routerPath,
      );
      return parsed.routerPath;
    }
  }

  // 2. Fall back to typed payload fields.
  const type = data.type as NotificationPayloadType | undefined;
  if (!type) return null;

  switch (type) {
    case "follow":
    case "follow_request": {
      // Prefer username; fall back to actor/sender ID (profile page must handle both)
      const username =
        data.senderUsername || data.actorUsername;
      const userId =
        data.actorUserId || data.senderUserId || data.senderId || data.userId;

      // Only navigate when username is a real username (not the fallback "Someone")
      if (username && username !== "Someone") {
        return `/(protected)/profile/${username}`;
      }
      if (userId) {
        // Route by integer ID — profile page may need to resolve it
        return `/(protected)/profile/${userId}`;
      }
      return null;
    }

    case "message": {
      if (data.conversationId) {
        return `/(protected)/chat/${data.conversationId}`;
      }
      // Sender-only fallback: open messages list and let the user find the thread
      return "/(protected)/messages";
    }

    case "dm": {
      // New DM where conversationId isn't yet available
      const senderId =
        data.senderUserId || data.senderId || data.actorUserId;
      if (senderId) {
        // Open messages list; the dm payload carries enough info for the UI
        return "/(protected)/messages";
      }
      return "/(protected)/messages";
    }

    case "like":
    case "mention":
    case "tag":
    case "post": {
      if (data.postId) {
        return `/(protected)/post/${data.postId}`;
      }
      return null;
    }

    case "comment": {
      if (data.postId && data.commentId) {
        return `/(protected)/comments/${data.postId}?commentId=${data.commentId}`;
      }
      if (data.postId) {
        return `/(protected)/comments/${data.postId}`;
      }
      return null;
    }

    case "event":
    case "event_invite":
    case "event_update":
    case "ticket": {
      const eventId = data.eventId || data.entityId;
      if (eventId) {
        return `/(protected)/events/${eventId}`;
      }
      return null;
    }

    case "sneaky_lynk":
    case "room_invite": {
      const roomId = data.roomId || data.entityId;
      if (roomId) {
        return `/(protected)/sneaky-lynk/room/${roomId}`;
      }
      return null;
    }

    case "call": {
      if (data.roomId) {
        return `/(protected)/call/${data.roomId}`;
      }
      return null;
    }

    default:
      console.log("[NotificationRouter] Unknown notification type:", type);
      return null;
  }
}
