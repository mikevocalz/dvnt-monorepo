"use client";

import { create } from "zustand";
import { ChevronDown, Send, Check, QrCode } from "lucide-react";
import { EventFlyer, type EventFlyerMedia } from "@dvnt/app/components/event/EventFlyer.web";
import { color, gradient } from "@dvnt/app/lib/theme";
import { tierAccent } from "@dvnt/app/lib/theme";

/**
 * Wallet group-order hero (design Surface 6 / prompt 5.6.5a). One order → one
 * expandable card: collapsed shows the event + "N tickets"; expanded shows N
 * children, each "Ticket {order_index} of {order_count}" with its own QR,
 * attendee name, status, and send/claim affordance. Backed by the live
 * order_index/order_count/attendee_name/claimed_by data. Apple-Wallet feel via
 * the perforated ticket-stub motif (the design system's signature risk).
 */
export interface GroupChildTicket {
  id: string;
  order_index: number;
  order_count: number;
  attendee_name?: string | null;
  tier?: string; // ga / vip / table / free
  status: "active" | "checked_in" | "claimed";
  claimed_by?: string | null;
  qr_token?: string | null;
}

export interface WalletGroupCardData {
  orderId: string;
  eventTitle: string;
  dateLabel: string;
  media: EventFlyerMedia;
  tickets: GroupChildTicket[];
}

const useWalletExpand = create<{ open: Record<string, boolean>; toggle: (id: string) => void }>((s) => ({
  open: {},
  toggle: (id) => s((p) => ({ open: { ...p.open, [id]: !p.open[id] } })),
}));

export function WalletGroupCard({ data }: { data: WalletGroupCardData }) {
  const open = useWalletExpand((s) => !!s.open[data.orderId]);
  const toggle = useWalletExpand((s) => s.toggle);
  const total = data.tickets.length;
  const checkedIn = data.tickets.filter((t) => t.status === "checked_in").length;

  return (
    <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${color.hairline}`, background: color.surface }}>
      {/* collapsed header */}
      <button
        onClick={() => toggle(data.orderId)}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 12, background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
      >
        <div style={{ width: 72, height: 56, borderRadius: 10, overflow: "hidden", flex: "0 0 auto" }}>
          <EventFlyer media={data.media} aspect={72 / 56} rounded={10} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "SpaceGrotesk, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: color.text, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {data.eventTitle}
          </div>
          <div style={{ color: color.textDim, fontSize: 12 }}>{data.dateLabel}</div>
        </div>
        <span style={{ fontFamily: "SpaceMono, ui-monospace, monospace", fontSize: 12, color: color.text, padding: "4px 10px", borderRadius: 8, background: color.surface2 }}>
          {total} {total === 1 ? "ticket" : "tickets"}
        </span>
        <ChevronDown size={18} color={color.textFaint} style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 240ms cubic-bezier(0.22,1,0.36,1)" }} />
      </button>

      {/* expanded children */}
      <div style={{ maxHeight: open ? 2000 : 0, opacity: open ? 1 : 0, overflow: "hidden", transition: "max-height 280ms cubic-bezier(0.22,1,0.36,1), opacity 240ms" }}>
        {checkedIn > 0 ? (
          <div style={{ padding: "0 14px 8px", fontFamily: "SpaceMono, ui-monospace, monospace", fontSize: 12, color: color.cyan }}>
            {checkedIn}/{total} checked in
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 12px 14px" }}>
          {data.tickets.map((t) => (
            <ChildStub key={t.id} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChildStub({ t }: { t: GroupChildTicket }) {
  const accent = tierAccent((t.tier ?? "ga") as any);
  const claimed = t.status === "claimed";
  const checkedIn = t.status === "checked_in";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: color.inkDeep, border: `1px solid ${color.hairline}` }}>
      {/* perforated tear on the left — the ticket-stub signature */}
      <span aria-hidden style={{ position: "absolute", left: 88, top: 8, bottom: 8, width: 0, borderLeft: `2px dashed ${color.hairline}` }} />
      <span aria-hidden style={{ position: "absolute", left: 82, top: -6, width: 12, height: 12, borderRadius: 6, background: color.ink }} />
      <span aria-hidden style={{ position: "absolute", left: 82, bottom: -6, width: 12, height: 12, borderRadius: 6, background: color.ink }} />

      {/* QR */}
      <div style={{ width: 64, height: 64, borderRadius: 8, background: claimed ? "rgba(255,255,255,0.06)" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", opacity: claimed ? 0.4 : 1 }}>
        <QrCode size={48} color={claimed ? color.textFaint : "#000"} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingLeft: 18 }}>
        <div style={{ fontFamily: "SpaceMono, ui-monospace, monospace", fontSize: 11, color: accent }}>
          Ticket {t.order_index} of {t.order_count}
        </div>
        <div style={{ fontFamily: "SpaceGrotesk, system-ui, sans-serif", fontWeight: 700, fontSize: 15, color: color.text }}>
          {t.attendee_name || (claimed ? `Claimed by ${t.claimed_by}` : "Open")}
        </div>
        <div style={{ marginTop: 4 }}>
          {checkedIn ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: color.cyan }}>
              <Check size={12} color={color.cyan} /> Checked in
            </span>
          ) : claimed ? (
            <span style={{ fontSize: 11, color: color.textFaint }}>Sent · read-only</span>
          ) : (
            <button style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: color.ink, background: gradient.deviantCss, border: 0, borderRadius: 8, padding: "5px 12px", cursor: "pointer" }}>
              <Send size={12} color={color.ink} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
