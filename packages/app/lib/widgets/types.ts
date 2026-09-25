/**
 * Widget data contracts (shared, pure — no native imports).
 *
 * These are the SAFE-ONLY shapes written into the App Group for the iOS widgets
 * and Live Activity to read. The app never writes spicy/NSFW content here — see
 * `safety.ts` and `dataset.ts`, which filter at this write layer so nothing
 * age-gated can leak onto a home/lock screen even via a stale timeline.
 */

/** Normalized tier for the widget badge (Prompt 8 tiers). */
export type WidgetTierLevel = "free" | "ga" | "vip" | "table" | "founders";

/** Flags any content-bearing record may carry; the safety filter reads these. */
export interface SafetyFlags {
  nsfw?: boolean | null;
  isNsfw?: boolean | null;
  isNSFW?: boolean | null;
  is_nsfw?: boolean | null;
  spicy?: boolean | null;
  visibility?: string | null;
}

// ── Widget output entries ────────────────────────────────────────────────────

export interface WidgetTicketEntry {
  ticketId: string;
  eventId: string;
  eventName: string;
  startAt: string | null; // ISO 8601 — drives the door countdown
  venueName: string | null;
  tier: WidgetTierLevel;
  tierLabel: string;
  flyerThumbUrl: string | null;
  dominantColor: string | null; // hex accent (Prompt 10)
  deepLink: string; // dvnt://tickets/<ticketId>
}

export interface WidgetBlogEntry {
  slug: string;
  title: string;
  coverUrl: string | null;
  dominantColor: string | null;
  authorName: string | null;
  readTimeMins: number | null;
  deepLink: string; // dvnt://blog/<slug>
}

export type WidgetSocialKind = "follow" | "activity" | "notification";

export interface WidgetSocialEntry {
  id: string;
  kind: WidgetSocialKind;
  title: string; // e.g. "ava started following you"
  avatarUrl: string | null;
  tier: WidgetTierLevel | null;
  deepLink: string; // dvnt://activity or dvnt://profile/<username>
}

/**
 * The complete safe-only payload the app writes to the App Group. Everything a
 * widget can render lives here; the widget bundle never queries the network.
 */
export interface WidgetDataset {
  generatedAt: string;
  tickets: WidgetTicketEntry[];
  /**
   * True when the user HAS upcoming tickets but every one was spicy-suppressed,
   * so the tickets widget must show the neutral branded state rather than empty.
   */
  ticketsSuppressed: boolean;
  unreadCount: number;
  blog: WidgetBlogEntry[];
  social: WidgetSocialEntry[];
}

/** Content state for the event Live Activity (Lock Screen + Dynamic Island). */
export interface EventLiveActivityState {
  eventId: string;
  eventName: string; // neutral title when `neutral` is true
  startAt: string; // ISO — countdown target
  venueName: string | null;
  /** Host broadcast, e.g. "Doors open in 5 min" (Prompt 7B). Neutralized if spicy. */
  broadcast: string | null;
  tier: WidgetTierLevel | null;
  dominantColor: string | null;
  /** True → spicy-suppressed: neutral naming + art only. */
  neutral: boolean;
  deepLink: string; // dvnt://tickets/<ticketId> or dvnt://events/<eventId>
}

// ── Source inputs (structurally match the app's API/store objects) ───────────

export interface TicketSource extends SafetyFlags {
  id?: string | null;
  ticketId?: string | null;
  eventId?: string | null;
  eventName?: string | null;
  eventTitle?: string | null;
  startAt?: string | null;
  startsAt?: string | null;
  venueName?: string | null;
  tier?: string | null;
  tierName?: string | null;
  flyerThumbUrl?: string | null;
  heroThumbUrl?: string | null;
  dominantColor?: string | null;
}

export interface BlogSource extends SafetyFlags {
  slug: string;
  title: string;
  coverUrl?: string | null;
  dominantColor?: string | null;
  authorName?: string | null;
  readTimeMins?: number | null;
}

export interface SocialSource extends SafetyFlags {
  id: string;
  kind?: WidgetSocialKind;
  title: string;
  avatarUrl?: string | null;
  tier?: string | null;
  username?: string | null;
  actorSafe?: boolean; // actor/target already known safe
}

export interface WidgetSyncSources {
  tickets?: TicketSource[];
  unreadCount?: number;
  blog?: BlogSource[];
  social?: SocialSource[];
  now?: Date; // injectable clock (tests)
}
