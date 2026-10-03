/**
 * Who counts as a host of an event's Sneaky Lynk.
 *
 * The event owner, or a co-organizer whose staff invite is accepted and whose
 * role is admin or editor. Same rule event-lynk-invite has used since it
 * shipped. A pending invite is not a host, and neither is a scanner.
 *
 * A failed lookup throws. Callers turn that into a 500, never into "not a
 * host" and never into "host".
 */
export const EVENT_LYNK_HOST_CO_ROLES = ["admin", "editor"] as const;

export async function isEventLynkHost(
  db: any,
  event: { id: number; host_id: string | null },
  userId: string,
): Promise<boolean> {
  if (event.host_id != null && String(event.host_id) === String(userId)) return true;
  const { data, error } = await db.from("event_co_organizers").select("id")
    .eq("event_id", event.id).eq("user_id", userId).eq("accepted", true)
    .in("role", [...EVENT_LYNK_HOST_CO_ROLES]).limit(1).maybeSingle();
  if (error) throw new Error("Could not verify event host");
  return !!data;
}
