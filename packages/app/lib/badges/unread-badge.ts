/** Badges count unread notifications/conversations, never individual push deliveries. */
export const UNREAD_BADGE_COLOR = "#8A40CF";

export function normalizeUnreadCount(count: unknown): number {
  return typeof count === "number" && Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 0;
}

export function unreadBadgeText(count: unknown): string | undefined {
  const unread = normalizeUnreadCount(count);
  return unread > 99 ? "99+" : unread > 0 ? String(unread) : undefined;
}

export function unreadAccessibilityLabel(
  destination: "Activity" | "Messages",
  count: unknown,
): string {
  const unread = normalizeUnreadCount(count);
  if (!unread) return destination;
  const item = destination === "Activity" ? "notification" : "conversation";
  return `${destination}, ${unread} unread ${item}${unread === 1 ? "" : "s"}`;
}
