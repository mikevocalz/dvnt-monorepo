/**
 * Event Detail Types
 * Types for the posh.vip-style Event Details "Moment Page"
 */

export interface EventDetail {
  id: string;
  title: string;
  description: string;
  date: string; // ISO date string
  endDate?: string;
  location: string;
  image: string;
  flyerImageUrl?: string | null;
  flyerVideoUrl?: string | null;
  images?: { type: string; url: string }[];
  youtubeVideoUrl?: string | null;
  price: number;
  likes?: number;
  attendees: number;
  maxAttendees?: number;
  host: EventHost;
  coOrganizer?: EventHost | null;
  averageRating?: number;
  totalReviews?: number;
  // Location coordinates (for weather + map)
  locationLat?: number;
  locationLng?: number;
  locationName?: string;
  locationAddress?: string;
  locationType?: "virtual" | "physical";
  // V2 fields
  visibility?: "public" | "private" | "link_only";
  ageRestriction?: "none" | "18+" | "21+";
  nsfw?: boolean;
  ticketingEnabled?: boolean;
  shareSlug?: string;
  // Derived / enriched fields
  category?: string;
  dressCode?: string;
  doorPolicy?: string;
  entryWindow?: string;
  lineup?: string[];
  perks?: string[];
  venues?: string[];
}

export interface EventHost {
  id?: string;
  username: string;
  name?: string;
  avatar: string;
  verified?: boolean;
  followersCount?: number;
}

/**
 * Organizer card payload (posh.vip-style "Hosted by" section).
 * Backed by the get_event_organizer RPC — identity + aggregate stats +
 * the viewer's follow relationship, all in one round-trip.
 */
export interface OrganizerSocials {
  instagram?: string;
  x?: string;
  website?: string;
}

export interface EventOrganizer {
  id: string;
  username: string;
  /** Display name — falls back to username at render time. */
  name?: string;
  avatar: string;
  verified: boolean;
  followersCount: number;
  /** Number of public, non-cancelled events this organizer hosts. */
  eventsCount: number;
  /** Sum of attendees across this organizer's public events. */
  totalAttendees: number;
  socials: OrganizerSocials;
  /** Does the current viewer already follow this organizer? */
  isFollowing: boolean;
  /** Is the viewer the organizer (hides the follow/contact CTAs)? */
  isSelf: boolean;
}

export interface TicketTier {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  description?: string;
  perks: string[];
  category: "admission" | "product" | "service";
  remaining: number;
  maxPerOrder: number;
  isSoldOut: boolean;
  tier: "free" | "ga" | "vip" | "table";
  glowColor: string;
}

export interface EventAttendee {
  id: string;
  username?: string;
  avatar?: string;
  initials?: string;
  color?: string;
  isFollowing?: boolean;
}

export interface CollapsibleDetail {
  icon: string;
  title: string;
  content: string | string[];
}
