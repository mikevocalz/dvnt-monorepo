/**
 * Shared helper: when inventory for an event tier frees up (a refund
 * or void), notify the oldest user on the waitlist for that tier and
 * stamp `notified_at` so we don't double-notify.
 *
 * Intentionally notifies ONE at a time — multiple seats opening would
 * normally fire separate webhook events, each of which will call this
 * once. If you need to claim N at once, call this in a loop.
 *
 * Uses the in-app notifications pipeline (send_notification edge fn
 * via notifyEventOrganizers pattern) so the user gets a push + in-app
 * row without any new wiring.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface NotifyArgs {
  eventId: number;
  ticketTypeId: string | null;
  tierName?: string | null;
  eventTitle?: string | null;
}

export async function notifyNextWaitlister(
  supabase: any,
  { eventId, ticketTypeId, tierName, eventTitle }: NotifyArgs,
): Promise<void> {
  try {
    // Find the oldest un-notified waitlister for this (event, tier).
    // ticket_type_id may be NULL in the row (meaning "any tier") —
    // treat it as a valid match when we don't have a specific tier.
    let query = supabase
      .from("event_waitlist")
      .select("id, user_id, guest_email")
      .eq("event_id", eventId)
      .is("notified_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (ticketTypeId != null) {
      // Match rows keyed to this tier OR to any-tier (NULL).
      query = query.or(
        `ticket_type_id.eq.${ticketTypeId},ticket_type_id.is.null`,
      );
    }
    const { data: rows, error } = await query;
    if (error) {
      console.error("[notify-waitlisters] lookup:", error);
      return;
    }
    const row = rows?.[0];
    if (!row) return; // No one waiting

    // Mark notified BEFORE we fire the notification — the conditional
    // update acts as a lock so concurrent webhook runs can't both
    // claim the same seat.
    const { data: claimed, error: claimErr } = await supabase
      .from("event_waitlist")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return;

    // Resolve user integer id for the notifications table
    if (!row.user_id) return; // guest_email path — no in-app notify yet

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", row.user_id)
      .maybeSingle();
    if (!user?.id) return;

    const title = tierName
      ? `${tierName} spot opened`
      : "A spot opened up";
    const body = eventTitle
      ? `Grab your ticket for ${eventTitle} before it's gone.`
      : "Grab your ticket before it's gone.";

    await supabase.from("notifications").insert({
      recipient_id: user.id,
      actor_id: null,
      type: "event_waitlist_promoted",
      entity_type: "event",
      entity_id: String(eventId),
    });

    // Best-effort push — don't block the webhook on push failures.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send_notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          userId: user.id,
          title,
          body,
          type: "event_waitlist_promoted",
          data: {
            entityType: "event",
            entityId: eventId,
            ticketTypeId,
          },
        }),
      });
    } catch (pushErr) {
      console.error(
        "[notify-waitlisters] push error (non-fatal):",
        pushErr,
      );
    }
  } catch (err) {
    console.error("[notify-waitlisters] unexpected:", err);
  }
}
