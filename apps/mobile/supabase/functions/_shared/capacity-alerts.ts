/**
 * Shared helper: notify event organizers as a ticket tier crosses the
 * 75 / 90 / 100 % sold thresholds.
 *
 * Idempotent — ticket_types.capacity_alert_level tracks the highest
 * level already reported, so retries / duplicate webhook deliveries
 * never double-notify.
 *
 * Usage (after incrementing quantity_sold):
 *   import { maybeFireCapacityAlerts } from "../_shared/capacity-alerts.ts";
 *   await maybeFireCapacityAlerts(supabase, { eventId, ticketTypeId });
 *
 * The function is fire-and-forget: it logs but never throws.
 */

import { notifyEventOrganizers } from "./notify-event-organizers.ts";

const THRESHOLDS = [75, 90, 100] as const;

interface MaybeFireArgs {
  eventId: number;
  ticketTypeId: string;
}

export async function maybeFireCapacityAlerts(
  supabase: any,
  { eventId, ticketTypeId }: MaybeFireArgs,
): Promise<void> {
  try {
    const { data: tier } = await supabase
      .from("ticket_types")
      .select("name, quantity_total, quantity_sold, capacity_alert_level")
      .eq("id", ticketTypeId)
      .maybeSingle();

    if (!tier) return;

    const total = Number(tier.quantity_total || 0);
    // Unlimited tiers (quantity_total = 0 or null) don't make sense to
    // alert on — there's no denominator.
    if (total <= 0) return;

    const sold = Number(tier.quantity_sold || 0);
    const percent = Math.min(100, Math.floor((sold / total) * 100));
    const lastLevel = Number(tier.capacity_alert_level || 0);

    // Highest NEW threshold crossed since the last alert.
    let crossed = 0;
    for (const t of THRESHOLDS) {
      if (percent >= t && lastLevel < t) crossed = t;
    }
    if (!crossed) return;

    // Persist the level FIRST so a concurrent webhook retry won't
    // double-send (the conditional write below is best-effort — two
    // racing writers would both update to the same level, which is
    // acceptable; the notification is the side-effect we de-dupe).
    const { error: updateErr } = await supabase
      .from("ticket_types")
      .update({ capacity_alert_level: crossed })
      .eq("id", ticketTypeId)
      .lt("capacity_alert_level", crossed);
    if (updateErr) {
      console.error("[capacity-alerts] level update error:", updateErr);
      return;
    }

    const tierName = tier.name || "Tickets";
    const remaining = Math.max(0, total - sold);
    const { title, body } =
      crossed === 100
        ? {
            title: `${tierName} sold out`,
            body: `Your ${tierName} tier just sold its last seat.`,
          }
        : crossed === 90
          ? {
              title: `${tierName} is 90% sold`,
              body: `Only ${remaining} ${tierName} seats left.`,
            }
          : {
              title: `${tierName} is 75% sold`,
              body: `${sold}/${total} sold — keep the momentum.`,
            };

    await notifyEventOrganizers(supabase, eventId, {
      type: "event_capacity_alert",
      title,
      body,
      data: {
        entityType: "event",
        entityId: eventId,
        ticketTypeId: String(ticketTypeId),
        percentSold: percent,
        threshold: crossed,
      },
    });
  } catch (err) {
    console.error("[capacity-alerts] unexpected:", err);
  }
}
