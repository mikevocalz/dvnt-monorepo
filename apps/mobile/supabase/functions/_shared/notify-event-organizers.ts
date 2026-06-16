/**
 * Shared helper: notify all organizers (host + co-hosts) for an event.
 *
 * Looks up the primary host and accepted co-organizers from event_co_organizers,
 * resolves their integer user IDs, and inserts notification rows.
 *
 * Usage:
 *   import { notifyEventOrganizers } from "../_shared/notify-event-organizers.ts";
 *   await notifyEventOrganizers(supabase, eventId, {
 *     type: "event_update",
 *     title: "Dispute opened",
 *     body: "A buyer disputed a charge for your event.",
 *     data: { entityType: "event", entityId: eventId },
 *   });
 */

interface NotifyPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Get all organizer auth_ids for an event (host + accepted co-organizers).
 */
export async function getEventOrganizerAuthIds(
  supabase: any,
  eventId: number,
): Promise<string[]> {
  const authIds: string[] = [];

  // 1. Get primary host
  const { data: event } = await supabase
    .from("events")
    .select("host_id")
    .eq("id", eventId)
    .single();

  if (event?.host_id) {
    authIds.push(event.host_id);
  }

  // 2. Get accepted co-organizers
  const { data: coOrgs } = await supabase
    .from("event_co_organizers")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("accepted", true);

  if (coOrgs?.length) {
    for (const co of coOrgs) {
      if (co.user_id && !authIds.includes(co.user_id)) {
        authIds.push(co.user_id);
      }
    }
  }

  return authIds;
}

/**
 * Resolve auth_ids (text) → integer user IDs from the users table.
 */
async function resolveIntegerUserIds(
  supabase: any,
  authIds: string[],
): Promise<number[]> {
  if (!authIds.length) return [];

  const { data: users } = await supabase
    .from("users")
    .select("id")
    .in("auth_id", authIds);

  return (users || []).map((u: any) => u.id);
}

/**
 * Notify all organizers (host + co-hosts) for an event.
 * Inserts notification rows in the DB for each organizer.
 */
export async function notifyEventOrganizers(
  supabase: any,
  eventId: number,
  payload: NotifyPayload,
): Promise<void> {
  try {
    const authIds = await getEventOrganizerAuthIds(supabase, eventId);
    if (!authIds.length) return;

    const userIds = await resolveIntegerUserIds(supabase, authIds);
    if (!userIds.length) return;

    // Insert notification rows for each organizer
    const rows = userIds.map((recipientId) => ({
      recipient_id: recipientId,
      actor_id: null,
      type: payload.type,
      entity_type: payload.data?.entityType || "event",
      entity_id: payload.data?.entityId
        ? String(payload.data.entityId)
        : String(eventId),
    }));

    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      console.error(
        "[notify-event-organizers] Insert error:",
        error,
      );
    }

    // Fire push notifications (best-effort, non-blocking)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    for (const userId of userIds) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send_notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({
            userId,
            title: payload.title,
            body: payload.body,
            type: payload.type,
            data: payload.data,
          }),
        });
      } catch (pushErr) {
        console.error(
          `[notify-event-organizers] Push error for user ${userId}:`,
          pushErr,
        );
      }
    }

    console.log(
      `[notify-event-organizers] Notified ${userIds.length} organizer(s) for event ${eventId}`,
    );
  } catch (err) {
    console.error("[notify-event-organizers] Error:", err);
  }
}
