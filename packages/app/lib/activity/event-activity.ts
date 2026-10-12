/** Event notification identity and navigation, shared by web and native. */
interface EventActivity {
  type: string;
  entityType?: string;
  entityId?: string;
  event?: { id?: string };
  user?: { username?: string; displayName?: string };
}

const EVENT_TYPES = new Set([
  "event_invite", "event_update", "event_co_organizer_invited",
  "event_co_organizer_accepted", "event_co_organizer_declined",
  "event_co_organizer_revoked", "event_cancelled", "event_changed",
  "event_broadcast", "event_postponed", "event_time_changed", "event_venue_changed",
]);

/** Numeric event identities must use the ID route; /events/:slug is title-based. */
export function eventActivityRoute(
  activity: EventActivity,
  platform: "web" | "native",
): string | null {
  if (activity.entityType !== "event" && !EVENT_TYPES.has(activity.type)) return null;
  const id = activity.entityType === "event"
    ? activity.entityId || activity.event?.id
    : activity.event?.id || activity.entityId;
  const root = platform === "web" ? "/feed/events" : "/(protected)/events";
  return id ? `${root}/${encodeURIComponent(id)}` : root;
}

/** Keep usernames for social activity and profile links. Broadcasts use the sender's name. */
export function activitySenderLabel(activity: EventActivity): string {
  if (activity.type === "event_broadcast") {
    const name = activity.user?.displayName?.trim();
    if (name) return name;
    const username = activity.user?.username?.trim();
    return username && username !== "user" ? username : "Event organizer";
  }
  return activity.user?.username || "user";
}
