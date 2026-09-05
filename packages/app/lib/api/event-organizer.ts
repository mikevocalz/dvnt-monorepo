/**
 * Event organizer card data — backed by the get_event_organizer RPC.
 *
 * One round-trip returns the host's identity, aggregate stats (events hosted +
 * total attendees), their website/social links, and whether the current viewer
 * follows them. Powers the posh.vip-style "Hosted by" section on the event
 * detail page (web + native).
 */
import { supabase } from "../supabase/client";
import { getCurrentUserIdSync, getCurrentUserId } from "./auth-helper";
import type {
  EventOrganizer,
  EventCoOrganizer,
  OrganizerSocials,
} from "../../features/events/types";

/**
 * Derive Instagram / X / website chips from the user's free-form `links`
 * array (plain URL strings) plus the dedicated `website` column. Anything
 * that isn't a recognized social host becomes the website fallback.
 */
export function parseOrganizerSocials(
  links: unknown,
  website?: string | null,
): OrganizerSocials {
  const out: OrganizerSocials = {};
  const list = Array.isArray(links) ? links : [];

  for (const raw of list) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (!url) continue;
    const lower = url.toLowerCase();
    const href = lower.startsWith("http") ? url : `https://${url}`;

    if (!out.instagram && lower.includes("instagram.com")) {
      out.instagram = href;
    } else if (
      !out.x &&
      (lower.includes("twitter.com") || lower.includes("x.com"))
    ) {
      out.x = href;
    } else if (!out.website) {
      out.website = href;
    }
  }

  if (!out.website && website && website.trim()) {
    const w = website.trim();
    out.website = w.toLowerCase().startsWith("http") ? w : `https://${w}`;
  }

  return out;
}

export const eventOrganizerApi = {
  async getEventOrganizer(eventId: string): Promise<EventOrganizer | null> {
    try {
      const viewerId = getCurrentUserIdSync() ?? (await getCurrentUserId());
      const { data, error } = await supabase.rpc("get_event_organizer", {
        p_event_id: parseInt(eventId),
        p_viewer_id: viewerId ?? null,
      });
      if (error) throw error;
      if (!data) return null;

      const o = data as any;
      return {
        id: String(o.id),
        username: o.username || "unknown",
        name: o.first_name || undefined,
        avatar: o.avatar || "",
        verified: Boolean(o.verified),
        followersCount: Number(o.followers_count) || 0,
        eventsCount: Number(o.events_count) || 0,
        totalAttendees: Number(o.total_attendees) || 0,
        socials: parseOrganizerSocials(o.links, o.website),
        isFollowing: Boolean(o.is_following),
        isSelf: Boolean(o.is_self),
      };
    } catch (error) {
      console.error("[Events] getEventOrganizer error:", error);
      return null;
    }
  },

  /**
   * Accepted co-organizers billed alongside the host.
   *
   * Reads the `get_event_co_organizers` definer RPC rather than the table: the
   * projection is fixed in SQL so `auth_id` never crosses the boundary, and the
   * table itself stays unreadable to clients. Pending invitees and `scanner`
   * door staff are excluded server-side — a pending invite is not consent to be
   * billed publicly, and a scanner is not a co-organizer.
   *
   * Failure returns [] so the host still renders; co-hosts are additive.
   */
  async getEventCoOrganizers(eventId: string): Promise<EventCoOrganizer[]> {
    try {
      const { data, error } = await supabase.rpc("get_event_co_organizers", {
        p_event_id: parseInt(eventId),
      });
      if (error) throw error;
      return ((data as any[]) ?? [])
        .filter((c) => c?.username)
        .map((c) => ({
          username: String(c.username),
          name: c.name || undefined,
          avatar: c.avatar || "",
          verified: Boolean(c.verified),
          // admin and editor are both billed as co-hosts; the distinction is an
          // edit-rights one and means nothing to someone reading the event.
          role: "Co-host" as const,
        }));
    } catch (error) {
      console.error("[Events] getEventCoOrganizers error:", error);
      return [];
    }
  },
};
