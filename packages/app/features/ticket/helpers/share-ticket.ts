/**
 * shareTicket — Share event ticket info via the native share sheet
 * Never shares QR payloads or sensitive wallet URLs.
 * Respects transferable flag.
 */

import { Share } from "react-native";
import type { Ticket } from "@dvnt/app/lib/stores/ticket-store";
import { formatEventClock, formatEventDay } from "@dvnt/app/lib/events/event-time";
import { shareUrls } from "@dvnt/app/lib/deep-linking/share-link";

export interface ShareTicketResult {
  success: boolean;
  error?: string;
}

/**
 * Share ticket event info.
 * - Non-transferable tickets share only event info (no deep link to ticket).
 * - Transferable tickets include a deep link.
 * - QR tokens are NEVER shared.
 */
export async function shareTicket(
  ticket: Ticket,
): Promise<ShareTicketResult> {
  try {
    const title = ticket.eventTitle || "Event";
    const tierLabel = ticket.tierName || ticket.tier?.toUpperCase() || "";
    // Share the EVENT (public route) — the receiver doesn't own the
    // ticket, so deep-linking to /ticket/<id> would just 403. Opens
    // the event detail where they can buy their own if it's still on
    // sale. HTTPS universal link works for both signed-in and guest
    // receivers thanks to resolveGuestPublicTarget.
    const deepLink = shareUrls.event(ticket.eventId);

    const lines: string[] = [title];

    if (ticket.eventLocation) {
      lines.push(`📍 ${ticket.eventLocation}`);
    }
    if (ticket.eventDate) {
      // Venue zone with its abbreviation, so a friend elsewhere reads the
      // door time the host set ("Friday, July 10, 2026 at 8:00 PM PDT").
      const zone = { eventTz: ticket.eventTz ?? null, isOnline: ticket.eventIsOnline ?? false };
      const formattedDate = formatEventDay(ticket.eventDate, zone, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const formattedTime = formatEventClock(ticket.eventDate, zone);
      if (formattedDate && formattedTime) {
        lines.push(`🗓 ${formattedDate} at ${formattedTime}`);
      }
    }
    if (tierLabel) {
      lines.push(`🎟 ${tierLabel}`);
    }

    // Only include deep link for transferable tickets
    if (ticket.transferable) {
      lines.push("");
      lines.push(`View ticket: ${deepLink}`);
    }

    const message = lines.join("\n");

    await Share.share(
      {
        message,
        title: `${title} Ticket`,
      },
      {
        dialogTitle: "Share Event Ticket",
        subject: `${title} Ticket`,
      },
    );

    return { success: true };
  } catch (err: any) {
    // User cancelled is not an error
    if (err?.message?.includes("dismiss") || err?.code === "ERR_SHARING_CANCELLED") {
      return { success: true };
    }
    console.error("[shareTicket] Error:", err);
    return { success: false, error: err?.message || "unknown" };
  }
}
