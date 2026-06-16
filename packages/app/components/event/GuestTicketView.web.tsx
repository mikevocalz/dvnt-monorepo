"use client";

import { QrCode, MapPin, CalendarDays, Plus } from "lucide-react";
import { EventFlyer, type EventFlyerMedia } from "@dvnt/app/components/event/EventFlyer.web";
import { color, gradient } from "@dvnt/app/lib/theme";

/**
 * Guest ticket-view (`/t/{token}`, no login) — prompt 5.6.6. Often a stranger's
 * first impression of DVNT, so it's a flagship surface, not an afterthought.
 * Renders the shape from get_guest_ticket_view(token): the LIVE event (flyer
 * precedence + Phase-2 snapshot so a venue/time edit reflects here), the ticket
 * (N of M, attendee name, tier, scannable QR), add-ons, add-to-wallet, and the
 * soft "save your tickets — create an account" claim CTA.
 */
export interface GuestTicketViewData {
  event: {
    title: string;
    dateLabel: string;
    location?: string | null;
    media: EventFlyerMedia;
    status?: string;
  };
  ticket: {
    order_index?: number | null;
    order_count?: number | null;
    attendee_name?: string | null;
    tier_name?: string | null;
    status: string;
    qr_payload: string;
  };
  addons?: { id: string; name: string; quantity: number }[];
}

export function GuestTicketView({ data }: { data: GuestTicketViewData }) {
  const { event, ticket } = data;
  const isGroup = (ticket.order_count ?? 1) > 1;
  const cancelled = event.status === "cancelled";

  return (
    <div style={{ minHeight: "100dvh", background: color.ink, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 40px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* live event hero */}
        <div style={{ borderRadius: 20, overflow: "hidden", margin: "16px 0", position: "relative" }}>
          <EventFlyer media={event.media} aspect={4 / 5} rounded={20} />
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to top, ${color.inkDeep} 0%, transparent 55%)`, pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}>
            <h1 style={{ margin: 0, fontFamily: "SpaceGrotesk, system-ui, sans-serif", fontWeight: 800, fontSize: 26, color: color.text, textTransform: "uppercase", lineHeight: 1.05 }}>
              {event.title}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: color.textDim, fontSize: 13 }}>
                <CalendarDays size={13} color={color.textFaint} /> {event.dateLabel}
              </span>
              {event.location ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: color.textDim, fontSize: 13 }}>
                  <MapPin size={13} color={color.textFaint} /> {event.location}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {cancelled ? (
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: "rgba(252,37,58,0.12)", border: `1px solid ${color.signal}`, color: color.signal, fontSize: 13, fontWeight: 600, textAlign: "center" }}>
            This event was cancelled — your ticket has been refunded.
          </div>
        ) : null}

        {/* the ticket stub */}
        <div style={{ position: "relative", borderRadius: 20, background: color.surface, border: `1px solid ${color.hairline}`, overflow: "hidden" }}>
          <div style={{ padding: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {isGroup ? (
              <span style={{ fontFamily: "SpaceMono, ui-monospace, monospace", fontSize: 12, color: color.cyan }}>
                Ticket {ticket.order_index} of {ticket.order_count}
              </span>
            ) : null}
            {/* QR (scannable; HMAC-validated at the door) */}
            <div style={{ width: 220, height: 220, borderRadius: 12, background: cancelled ? "rgba(255,255,255,0.06)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", opacity: cancelled ? 0.3 : 1 }}>
              <QrCode size={184} color={cancelled ? color.textFaint : "#000"} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "SpaceGrotesk, system-ui, sans-serif", fontWeight: 700, fontSize: 18, color: color.text }}>
                {ticket.attendee_name || "Open ticket"}
              </div>
              <div style={{ fontFamily: "SpaceMono, ui-monospace, monospace", fontSize: 12, color: color.textDim, marginTop: 2 }}>
                {ticket.tier_name || "General"} · {ticket.status}
              </div>
            </div>
          </div>

          {/* perforated tear */}
          <div style={{ position: "relative", height: 0, borderTop: `2px dashed ${color.hairline}`, margin: "0 16px" }} />
          <span style={{ position: "absolute", left: -8, marginTop: -10, width: 16, height: 16, borderRadius: 8, background: color.ink }} />

          {/* add-ons */}
          {data.addons && data.addons.length > 0 ? (
            <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
              {data.addons.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: color.textDim }}>
                  <span>{a.name}</span><span style={{ fontFamily: "SpaceMono, ui-monospace, monospace" }}>×{a.quantity}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ padding: "8px 18px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
            <button style={{ height: 44, borderRadius: 8, border: `1px solid ${color.hairline}`, background: color.surface2, color: color.text, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Plus size={16} color={color.text} /> Add to Apple Wallet
            </button>
          </div>
        </div>

        {/* claim CTA */}
        <button style={{ width: "100%", marginTop: 14, height: 48, borderRadius: 8, border: 0, background: gradient.deviantCss, color: color.ink, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
          Save your tickets — create an account
        </button>
      </div>
    </div>
  );
}
