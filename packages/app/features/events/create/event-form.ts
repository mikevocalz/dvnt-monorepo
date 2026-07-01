/**
 * Event Creation — shared form core (PROMPT 20).
 *
 * The SINGLE source of truth for event-creation field metadata, validation and
 * the publish payload, shared by the mobile wizard (create.tsx) and the web
 * multi-section form (event-create.web.tsx). Mobile and web render different
 * layouts but MUST stay one schema: same fields, same validation, same payload.
 *
 * Important schema facts (verified against migrations, 2026-06-20):
 *  - The `events` table has a `category` column but NO `event_type` column
 *    (event_type lives on `stripe_events`). The 26-option Event Type therefore
 *    persists to `category`. There is no `tags` column — tags are secondary and
 *    fall back into `category` only when no Event Type is chosen.
 *  - Paid tiers must be >= $2.00 (MIN_PAID_TIER_CENTS) or server-side fee
 *    computation produces a negative organizer transfer at checkout.
 */

import type { EventType } from "@dvnt/app/lib/stores/create-event-store";

// ── Event Type taxonomy (canonical) ─────────────────────────────────────────
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  virtual_session: "Virtual Session",
  party: "Party",
  picnic: "Picnic",
  game_night: "Game Night",
  panel: "Panel",
  happy_hour: "Happy Hour",
  wine_down: "Wine Down",
  kickback: "Kickback",
  ball: "Ball",
  kiki: "Kiki",
  pool_party: "Pool Party",
  spoken_word: "Spoken Word",
  open_mic: "Open Mic",
  karaoke: "Karaoke",
  bike_ride: "Bike Ride",
  walk_run: "Walk / Run",
  fitness_training: "Fitness Training",
  yoga: "Yoga",
  meditation: "Meditation",
  bate_session: "Bate Session",
  sex_party: "Sex Party",
  kink_fetish_party: "Kink / Fetish Party",
  training: "Training",
  cooking_class: "Cooking Class",
  mixology: "Mixology",
  dance_class: "Dance Class",
  other: "Other",
};

export const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = (
  Object.keys(EVENT_TYPE_LABELS) as EventType[]
).map((value) => ({ value, label: EVENT_TYPE_LABELS[value] }));

/** Suggested freeform tags surfaced in both create flows. */
export const SUGGESTED_TAGS = [
  "music",
  "tech",
  "networking",
  "food",
  "art",
  "sports",
  "nightlife",
  "wellness",
  "education",
  "charity",
] as const;

/** Paid tiers below this floor produce a negative organizer transfer at checkout. */
export const MIN_PAID_TIER_CENTS = 200;

// ── The slice of the create-event store the shared core reads ────────────────
export interface TicketTierLike {
  priceCents: number;
}

export interface EventFormDraft {
  title: string;
  description: string;
  eventDate: string;
  endDate: string | null;
  location: string;
  locationData: {
    name?: string;
    latitude?: number;
    longitude?: number;
    address?: string;
  } | null;
  isOnline: boolean;
  eventType: EventType | null;
  tags: string[];
  visibility: "public" | "private" | "link_only";
  ageRestriction: "none" | "18+" | "21+";
  isNsfw: boolean;
  dressCode: string;
  doorPolicy: string;
  lineup: string[];
  perks: string[];
  disclaimers: string;
  youtubeUrl: string;
  ticketingEnabled: boolean;
  ticketPrice: string;
  maxAttendees: string;
  ticketTiers: TicketTierLike[];
  agreementAccepted: boolean;
}

// ── Ticketing helpers ────────────────────────────────────────────────────────

/** True when ticketing is on AND at least one tier (or the flat price) is paid. */
export function hasPaidTier(d: EventFormDraft): boolean {
  if (!d.ticketingEnabled) return false;
  if (d.ticketTiers.length > 0) return d.ticketTiers.some((t) => t.priceCents > 0);
  const flat = parseFloat(d.ticketPrice);
  return Number.isFinite(flat) && flat > 0;
}

/** Paid tiers (or the flat price) priced below the $2 floor. Empty when clean. */
export function belowFloor(d: EventFormDraft): boolean {
  if (!hasPaidTier(d)) return false;
  if (d.ticketTiers.length > 0) {
    return d.ticketTiers.some(
      (t) => t.priceCents > 0 && t.priceCents < MIN_PAID_TIER_CENTS,
    );
  }
  const flat = parseFloat(d.ticketPrice);
  return Number.isFinite(flat) && flat > 0 && flat < MIN_PAID_TIER_CENTS / 100;
}

// ── Validation (unified required set, signed off 2026-06-20) ─────────────────
// Required to publish: Title, Event Type, Date/Start, Location (or Virtual),
// plus accepted terms when the event is paid. Everything else is optional.

export interface EventFormErrors {
  title?: string;
  eventType?: string;
  date?: string;
  location?: string;
  price?: string;
  terms?: string;
}

export function validateEventDraft(d: EventFormDraft): {
  ok: boolean;
  errors: EventFormErrors;
} {
  const errors: EventFormErrors = {};

  if (!d.title.trim()) errors.title = "Give your event a title.";
  if (!d.eventType) errors.eventType = "Pick an event type.";

  const start = d.eventDate ? new Date(d.eventDate) : null;
  if (!start || Number.isNaN(start.getTime())) {
    errors.date = "Choose when it starts.";
  } else if (d.endDate) {
    const end = new Date(d.endDate);
    if (!Number.isNaN(end.getTime()) && end.getTime() <= start.getTime()) {
      errors.date = "End time must be after the start.";
    }
  }

  if (!d.isOnline && !d.location.trim()) {
    errors.location = "Add a venue, or mark the event online.";
  }

  if (belowFloor(d)) {
    errors.price = "Paid tickets must be at least $2.00.";
  }

  if (hasPaidTier(d) && !d.agreementAccepted) {
    errors.terms = "Accept the ticketing agreement to publish a paid event.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

// ── Publish payload builder (unified) ────────────────────────────────────────
// Produces the `eventData` object that eventsApi.createEvent expects. Media is
// passed in already-uploaded (the platform layer owns the upload pipeline).

export interface BuiltEventMedia {
  /** Cover image URL (already uploaded to the CDN). */
  image?: string;
  /** Additional images as [{ type:"image", url }]. */
  images?: { type: string; url: string }[];
  /** Still flyer image URL (3:5). This single field serves both as the
   *  flyer in static contexts (wallet pass, OG image, ICS share) AND as
   *  the poster/fallback when a video flyer is also set. There is no
   *  separate `videoPosterUrl` — flyer = poster. */
  flyerImageUrl?: string;
  /** Video flyer URL — hero, autoplay-muted in feed. Priority over the
   *  still flyer for display when both are set. Static contexts always
   *  use `flyerImageUrl` (never the video). */
  videoFlyerUrl?: string;
}

export function buildEventInsert(d: EventFormDraft, media: BuiltEventMedia = {}) {
  const maxAttendees = d.maxAttendees ? parseInt(d.maxAttendees, 10) : undefined;
  const price = d.ticketingEnabled ? parseFloat(d.ticketPrice) || 0 : 0;

  return {
    title: d.title.trim(),
    description: d.description.trim(),
    date: d.eventDate,
    endDate: d.endDate || undefined,
    location: d.isOnline ? "Online" : d.location.trim(),
    price,
    maxAttendees: Number.isFinite(maxAttendees as number) ? maxAttendees : undefined,
    visibility: d.visibility,
    isOnline: d.isOnline,
    image: media.image,
    images: media.images,
    flyerImageUrl: media.flyerImageUrl,
    videoFlyerUrl: media.videoFlyerUrl,
    youtubeVideoUrl: d.youtubeUrl.trim() || undefined,
    locationLat: d.locationData?.latitude,
    locationLng: d.locationData?.longitude,
    locationName: d.locationData?.name,
    locationAddress: d.locationData?.address,
    locationType: d.isOnline ? "virtual" : "physical",
    // Event Type is the structured category (no event_type column on events).
    // event_type is forwarded too so createEvent can prefer it over tags[0].
    category: d.eventType || d.tags[0] || undefined,
    event_type: d.eventType || undefined,
    ageRestriction: d.ageRestriction !== "none" ? d.ageRestriction : undefined,
    ticketingEnabled: d.ticketingEnabled,
    dressCode: d.dressCode.trim() || undefined,
    doorPolicy: d.doorPolicy.trim() || undefined,
    lineup: d.lineup.length > 0 ? d.lineup : undefined,
    perks: d.perks.length > 0 ? d.perks : undefined,
    disclaimers: d.disclaimers.trim() || undefined,
    nsfw: d.isNsfw || undefined,
  };
}
