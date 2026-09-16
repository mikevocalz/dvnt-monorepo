/** Remove event cards without confusing an unrelated post/user with the same ID. */
export function removeEventFromData(data: any, eventId: string, eventContext = false): any {
  if (data == null || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    const next = data.map((item) => removeEventFromData(item, eventId, eventContext)).filter((item) => item !== null);
    return next.length === data.length && next.every((item, i) => item === data[i]) ? data : next;
  }
  const isEvent = eventContext || data.type === "event" || data.kind === "event" || (
    typeof data.title === "string" && typeof data.location === "string" &&
    (data.fullDate != null || data.start_date != null || data.date != null)
  );
  const id = data.event_id ?? data.eventId ?? data.id;
  if (isEvent && id != null && String(id) === String(eventId)) return null;
  let next = data;
  // Restrict traversal to query containers and explicit event relationships.
  // Never walk author/profile/user objects based on ID alone.
  for (const key of ["pages", "data", "items", "events", "posts", "results", "event"]) {
    if (!data[key] || typeof data[key] !== "object") continue;
    const child = removeEventFromData(data[key], eventId, key === "events" || key === "event" || eventContext);
    if (child !== data[key]) {
      if (next === data) next = { ...data };
      next[key] = child;
    }
  }
  return next;
}
