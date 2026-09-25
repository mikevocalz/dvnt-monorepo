/**
 * Pure builders: source records → the SAFE-ONLY WidgetDataset and Live Activity
 * state. No native imports, fully unit-testable. Spicy filtering happens HERE,
 * before anything is handed to the native App-Group writer (see sync.ts), so the
 * shared store only ever holds safe content.
 */
import { filterWidgetSafe, isWidgetSafe } from "./safety";
import type {
  BlogSource,
  EventLiveActivityState,
  SocialSource,
  TicketSource,
  WidgetBlogEntry,
  WidgetDataset,
  WidgetSocialEntry,
  WidgetSyncSources,
  WidgetTicketEntry,
  WidgetTierLevel,
} from "./types";

const TICKETS_LIMIT = 8;
const BLOG_LIMIT = 6;
const SOCIAL_LIMIT = 6;

/** Normalize a raw tier/tierName into the widget badge level. */
export function normalizeTier(
  tier?: string | null,
  tierName?: string | null,
): WidgetTierLevel {
  const name = `${tier ?? ""} ${tierName ?? ""}`.toLowerCase();
  if (name.includes("founder")) return "founders";
  if (name.includes("vip")) return "vip";
  if (name.includes("table") || name.includes("booth")) return "table";
  if (name.includes("free")) return "free";
  return "ga";
}

export function tierLabel(level: WidgetTierLevel, tierName?: string | null): string {
  if (tierName && tierName.trim()) return tierName.trim();
  switch (level) {
    case "founders":
      return "Founders";
    case "vip":
      return "VIP";
    case "table":
      return "Table";
    case "free":
      return "Free";
    default:
      return "GA";
  }
}

function firstString(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) if (v != null && String(v).trim() !== "") return String(v);
  return null;
}

function ticketStart(t: TicketSource): string | null {
  return firstString(t.startAt, t.startsAt);
}

function toTicketEntry(t: TicketSource): WidgetTicketEntry | null {
  const ticketId = firstString(t.ticketId, t.id);
  const eventId = firstString(t.eventId);
  if (!ticketId || !eventId) return null;
  const level = normalizeTier(t.tier, t.tierName);
  return {
    ticketId,
    eventId,
    eventName: firstString(t.eventName, t.eventTitle) ?? "Your event",
    startAt: ticketStart(t),
    venueName: firstString(t.venueName),
    tier: level,
    tierLabel: tierLabel(level, t.tierName),
    flyerThumbUrl: firstString(t.flyerThumbUrl, t.heroThumbUrl),
    dominantColor: firstString(t.dominantColor),
    deepLink: `dvnt://tickets/${ticketId}`,
  };
}

/** Only future (or currently-live) tickets, soonest first. */
function isUpcoming(startAt: string | null, now: Date): boolean {
  if (!startAt) return true; // undated tickets still surface
  const t = Date.parse(startAt);
  if (Number.isNaN(t)) return true;
  // keep for 6h after start so a live event still shows
  return t > now.getTime() - 6 * 60 * 60 * 1000;
}

/**
 * Build the tickets slice. Returns the safe upcoming tickets AND whether the
 * user's tickets were entirely spicy-suppressed (drives the neutral state).
 */
export function buildTickets(
  sources: TicketSource[] | undefined,
  now: Date,
): { tickets: WidgetTicketEntry[]; suppressed: boolean } {
  const all = sources ?? [];
  const upcomingAll = all.filter((t) => isUpcoming(ticketStart(t), now));
  const safe = filterWidgetSafe(upcomingAll);
  const tickets = safe
    .map(toTicketEntry)
    .filter((e): e is WidgetTicketEntry => e !== null)
    .sort((a, b) => (Date.parse(a.startAt ?? "") || 0) - (Date.parse(b.startAt ?? "") || 0))
    .slice(0, TICKETS_LIMIT);
  // Suppressed = the user has upcoming tickets, but none survived the safe filter.
  const suppressed = tickets.length === 0 && upcomingAll.length > 0;
  return { tickets, suppressed };
}

export function buildBlog(sources: BlogSource[] | undefined): WidgetBlogEntry[] {
  return filterWidgetSafe(sources)
    .slice(0, BLOG_LIMIT)
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      coverUrl: firstString(p.coverUrl),
      dominantColor: firstString(p.dominantColor),
      authorName: firstString(p.authorName),
      readTimeMins: p.readTimeMins ?? null,
      deepLink: `dvnt://blog/${p.slug}`,
    }));
}

export function buildSocial(sources: SocialSource[] | undefined): WidgetSocialEntry[] {
  return filterWidgetSafe(sources)
    .filter((s) => s.actorSafe !== false) // drop anything whose actor/target isn't safe
    .slice(0, SOCIAL_LIMIT)
    .map((s) => ({
      id: s.id,
      kind: s.kind ?? "activity",
      title: s.title,
      avatarUrl: firstString(s.avatarUrl),
      tier: s.tier ? normalizeTier(s.tier) : null,
      deepLink: s.username ? `dvnt://profile/${s.username}` : "dvnt://activity",
    }));
}

/** Assemble the complete safe-only dataset written to the App Group. */
export function buildWidgetDataset(sources: WidgetSyncSources): WidgetDataset {
  const now = sources.now ?? new Date();
  const { tickets, suppressed } = buildTickets(sources.tickets, now);
  return {
    generatedAt: now.toISOString(),
    tickets,
    ticketsSuppressed: suppressed,
    unreadCount: Math.max(0, Math.floor(sources.unreadCount ?? 0)),
    blog: buildBlog(sources.blog),
    social: buildSocial(sources.social),
  };
}

/**
 * Build a safe Live Activity state from an event + optional host broadcast.
 * A spicy event yields a NEUTRAL activity: no spicy name/art on the Lock Screen.
 */
export function buildEventLiveActivityState(input: {
  eventId: string;
  ticketId?: string | null;
  eventName?: string | null;
  startAt: string;
  venueName?: string | null;
  broadcast?: string | null;
  tier?: string | null;
  tierName?: string | null;
  dominantColor?: string | null;
  safety?: import("./types").SafetyFlags;
}): EventLiveActivityState {
  const neutral = !isWidgetSafe(input.safety ?? {});
  const level = input.tier || input.tierName ? normalizeTier(input.tier, input.tierName) : null;
  return {
    eventId: input.eventId,
    eventName: neutral ? "Your event starts soon" : firstString(input.eventName) ?? "Your event",
    startAt: input.startAt,
    venueName: neutral ? null : firstString(input.venueName),
    broadcast: neutral ? null : firstString(input.broadcast),
    tier: neutral ? null : level,
    dominantColor: neutral ? null : firstString(input.dominantColor),
    neutral,
    deepLink: input.ticketId
      ? `dvnt://tickets/${input.ticketId}`
      : `dvnt://events/${input.eventId}`,
  };
}
