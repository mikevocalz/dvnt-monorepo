/**
 * Event Analytics API
 *
 * Host-only read of aggregate numbers for a single event.
 * Backed by supabase/functions/event-analytics — one JSON round trip.
 */

import { invokeEdge } from "./invoke-edge";

export interface EventRevenueSummary {
  grossCents: number;
  refundsCents: number;
  dvntFeeCents: number;
  stripeFeeCents: number;
  netCents: number;
  calculatedAt: string | null;
}

export interface EventTicketStats {
  total: number;
  active: number;
  checkedIn: number;
  refunded: number;
  void: number;
  transferPending: number;
}

export interface EventTierAnalytics {
  id: string;
  name: string;
  priceCents: number;
  quantityTotal: number;
  quantitySold: number;
  remaining: number;
  percentSold: number;
  revenueCents: number;
  isActive: boolean;
}

export interface EventPromoCodeAnalytics {
  id: string;
  code: string;
  discountType: "percent" | "fixed_cents" | string;
  discountValue: number;
  usesCount: number;
  maxUses: number | null;
}

export interface EventAnalyticsSummary {
  eventId: string;
  title: string;
  revenue: EventRevenueSummary;
  ticketStats: EventTicketStats;
  tiers: EventTierAnalytics[];
  promoCodes: EventPromoCodeAnalytics[];
}

export interface EventAttendeeRow {
  ticketId: string;
  buyerUsername: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  tierName: string | null;
  tierPriceCents: number | null;
  status: string;
  purchaseAmountCents: number;
  checkedInAt: string | null;
  createdAt: string;
}

export interface EventAttendeesResponse {
  eventId: string;
  title: string;
  attendees: EventAttendeeRow[];
}

type AnalyticsResponse<T> = ({ ok: true } & T) | { ok: false; error?: string };

function unwrap<T>(
  label: string,
  res: { data?: AnalyticsResponse<T>; error?: { message: string } },
): T | null {
  if (res.error) {
    console.error(`[EventAnalytics] ${label}:`, res.error.message);
    return null;
  }
  const data = res.data;
  if (!data || data.ok !== true) {
    if (data && "error" in data && data.error) {
      console.error(`[EventAnalytics] ${label}:`, data.error);
    }
    return null;
  }
  const { ok: _ok, ...rest } = data;
  return rest as T;
}

export const eventAnalyticsApi = {
  async getSummary(eventId: string | number): Promise<EventAnalyticsSummary | null> {
    const res = await invokeEdge<AnalyticsResponse<EventAnalyticsSummary>>(
      "event-analytics",
      { event_id: eventId },
    );
    return unwrap<EventAnalyticsSummary>("getSummary", res);
  },

  async getAttendees(
    eventId: string | number,
  ): Promise<EventAttendeesResponse | null> {
    const res = await invokeEdge<AnalyticsResponse<EventAttendeesResponse>>(
      "event-analytics",
      { event_id: eventId, action: "attendees" },
    );
    return unwrap<EventAttendeesResponse>("getAttendees", res);
  },
};

/**
 * Convert an attendees response into a CSV string. Handles values that
 * contain commas, quotes, and newlines per RFC 4180 (quote-wrap and
 * double-up internal quotes).
 */
export function attendeesToCsv(rows: EventAttendeeRow[]): string {
  const headers = [
    "Ticket ID",
    "Username",
    "Email",
    "Name",
    "Tier",
    "Tier Price",
    "Status",
    "Paid",
    "Checked In At",
    "Purchased At",
  ];

  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const money = (cents: number | null): string =>
    cents == null ? "" : `$${(cents / 100).toFixed(2)}`;

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.ticketId,
        r.buyerUsername ?? "",
        r.buyerEmail ?? "",
        r.buyerName ?? "",
        r.tierName ?? "",
        money(r.tierPriceCents),
        r.status,
        money(r.purchaseAmountCents),
        r.checkedInAt ?? "",
        r.createdAt,
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n");
}
