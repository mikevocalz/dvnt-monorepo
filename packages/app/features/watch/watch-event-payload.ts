import type { WatchEventMoment } from "./watch-event-moments";
import { watchRendition } from "./watch-rendition";

export type WatchEventAction = "going" | "interested" | "not_going" | "waitlist_join" | "waitlist_leave" | "open_on_phone" | "archive_more" | "archive_previous" | "load_moments";
export type WatchEventSection = "tonight" | "invitations" | "going" | "interested" | "waitlist" | "saved" | "hosting" | "past";
export interface WatchEventWaitlist {
  ticketTypeId?: string;
  offerStatus: string;
  offerExpiresAt?: string;
}
export interface WatchEventWeather { tempF: number; label?: string; generatedAt: string; forecastAt?: string; precipPct?: number }
export interface WatchEvent {
  id: string;
  title: string;
  startAt?: string;
  endAt?: string;
  timeZone?: string;
  imageURL?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  isOnline: boolean;
  status: string;
  ticketingEnabled: boolean;
  rsvp?: string;
  inviteStatus?: string;
  saved: boolean;
  host: boolean;
  waitlist: WatchEventWaitlist[];
  canJoinWaitlist: boolean;
  weather?: WatchEventWeather;
  moments?: WatchEventMoment[];
  momentsStatus?: "ready" | "unavailable";
}
export interface WatchEventEnvelope {
  protocol: 2;
  accountGen: string;
  syncedAt: number;
  events: WatchEvent[];
  status: "ready" | "error";
  error?: string;
  hasMore?: boolean;
  hasPrevious?: boolean;
}
export interface WatchEventCommand {
  protocol: 2;
  accountGen: string;
  operationId: string;
  type: "eventAction";
  eventId: string;
  action: WatchEventAction;
  ticketTypeId?: string;
  issuedAt: number;
  expiresAt: number;
}
export interface WatchEventResult {
  protocol: 2;
  accountGen: string;
  operationId: string;
  eventId: string;
  status: "confirmed" | "failed" | "rejected";
  message?: string;
}

export interface WatchEventRow {
  id: number | string;
  title: string | null;
  start_date: string | null;
  end_date?: string | null;
  event_tz?: string | null;
  cover_image_url?: string | null;
  flyer_image_url?: string | null;
  video_poster_url?: string | null;
  location?: string | null;
  location_name?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  is_online?: boolean | null;
  status?: string | null;
  ticketing_enabled?: boolean | null;
  host_id?: string | null;
}
export interface WatchEventRelations {
  authId: string;
  rsvps: { event_id: number | string; status: string }[];
  invitations: { event_id: number | string; status: string }[];
  likes: { event_id: number | string }[];
  waitlist: { event_id: number | string; ticket_type_id?: string | null; offer_status?: string; offer_expires_at?: string | null }[];
  tiers: { event_id: number | string; quantity_total: number | null; quantity_sold: number | null; sale_start?: string | null; sale_end?: string | null; tier_visibility?: string | null }[];
}
const iso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;

export function buildWatchEvents(rows: WatchEventRow[], relations: WatchEventRelations, now = Date.now()): WatchEvent[] {
  return rows.map((row) => {
    const id = String(row.id);
    const tiers = relations.tiers.filter((tier) => String(tier.event_id) === id && (!tier.tier_visibility || tier.tier_visibility === "public") &&
      (!tier.sale_start || Date.parse(tier.sale_start) <= now) && (!tier.sale_end || Date.parse(tier.sale_end) > now));
    const image = [row.cover_image_url, row.flyer_image_url, row.video_poster_url].find((url) => typeof url === "string" && /^https:\/\//.test(url) && !/\.(mp4|mov|webm|m4v)(\?|$)|\/(post|flyer|event|story)-video\//i.test(url));
    return {
      id, title: row.title?.trim() || "Event", startAt: iso(row.start_date), endAt: iso(row.end_date),
      timeZone: row.event_tz || undefined, imageURL: watchRendition(image, 320),
      location: row.location_name || row.location || undefined,
      latitude: Number.isFinite(row.location_lat) ? row.location_lat! : undefined,
      longitude: Number.isFinite(row.location_lng) ? row.location_lng! : undefined,
      isOnline: row.is_online === true, status: row.status || "unknown", ticketingEnabled: row.ticketing_enabled !== false,
      rsvp: relations.rsvps.find((r) => String(r.event_id) === id)?.status,
      inviteStatus: relations.invitations.find((r) => String(r.event_id) === id)?.status,
      saved: relations.likes.some((r) => String(r.event_id) === id), host: row.host_id === relations.authId,
      waitlist: relations.waitlist.filter((r) => String(r.event_id) === id).map((r) => ({
        ticketTypeId: r.ticket_type_id || undefined, offerStatus: r.offer_status || "none", offerExpiresAt: iso(r.offer_expires_at),
      })),
      canJoinWaitlist: row.status === "active" && tiers.length > 0 && tiers.every((t) => t.quantity_total !== null && Number(t.quantity_sold) >= t.quantity_total),
    };
  });
}

export function validateEventCommand(raw: unknown, accountGen: string, now = Date.now() / 1000): WatchEventCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.protocol !== 2 || c.accountGen !== accountGen || !accountGen || c.type !== "eventAction") return null;
  if (typeof c.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.operationId)) return null;
  if (typeof c.eventId !== "string" || !/^[1-9]\d*$/.test(c.eventId)) return null;
  if (!["going", "interested", "not_going", "waitlist_join", "waitlist_leave", "open_on_phone", "archive_more", "archive_previous", "load_moments"].includes(String(c.action))) return null;
  if (c.ticketTypeId !== undefined && (typeof c.ticketTypeId !== "string" || !/^[0-9a-f-]{36}$/i.test(c.ticketTypeId))) return null;
  if (typeof c.issuedAt !== "number" || typeof c.expiresAt !== "number" || !Number.isFinite(c.issuedAt) || !Number.isFinite(c.expiresAt) ||
      c.issuedAt > now + 5 || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 30) return null;
  return c as unknown as WatchEventCommand;
}
