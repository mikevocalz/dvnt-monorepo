/**
 * Drives the SAFE-ONLY widget dataset from the app's data on iOS.
 *
 * IMPORTANT (safety): a raw ticket record carries NO nsfw/visibility flag, so a
 * ticket alone cannot prove its event is safe. This hook enriches each ticket
 * with its event's `nsfw` / `visibility` and DEFAULTS TO EXCLUDED when the event
 * can't be resolved — so an unknown or spicy event never surfaces, and a
 * user whose only ticket is spicy falls through to the neutral branded state.
 *
 * Blog + unread are safe by construction (published posts, own message count).
 * The actual spicy filtering + neutral fallback live in buildWidgetDataset.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { useMyTickets } from "./use-tickets";
import { useUnreadMessageCount } from "./use-messages";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { fetchBlogPosts, blogMediaUrl } from "@dvnt/app/lib/api/blog";
import { blogByline } from "@dvnt/app/lib/api/blog";
import { syncWidgets } from "@dvnt/app/lib/widgets";
import type { BlogSource, TicketSource } from "@dvnt/app/lib/widgets";

async function buildTicketSources(records: readonly { [k: string]: unknown }[]): Promise<TicketSource[]> {
  const active = records.filter((r) => (r.status ?? "active") === "active");
  const out: TicketSource[] = [];
  for (const r of active) {
    const eventId = String(r.event_id ?? "");
    if (!eventId) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ev: any = null;
    try {
      ev = await eventsApi.getEventById(eventId);
    } catch {
      ev = null;
    }
    // Default to UNSAFE when the event can't be resolved.
    const nsfw = ev ? !!ev.nsfw : true;
    const visibility: string = ev ? (ev.visibility ?? "public") : "unknown";
    out.push({
      ticketId: String(r.id ?? ""),
      eventId,
      eventName: (ev?.title as string) ?? (r.event_title as string) ?? "Your event",
      startAt:
        (ev?.startAt as string) ??
        (ev?.date as string) ??
        (r.event_date as string) ??
        null,
      venueName: (ev?.location as string) ?? (r.event_location as string) ?? null,
      tierName: (r.ticket_type_name as string) ?? null,
      flyerThumbUrl:
        (ev?.flyerImageUrl as string) ??
        (ev?.image as string) ??
        (r.event_image as string) ??
        null,
      dominantColor: (ev?.dominantColor as string) ?? null,
      nsfw,
      visibility,
    });
  }
  return out;
}

async function buildBlogSources(): Promise<BlogSource[]> {
  try {
    const page = await fetchBlogPosts({ page: 1, limit: 6 });
    return page.docs.map((p) => ({
      slug: p.slug,
      title: p.title,
      coverUrl: blogMediaUrl(p.heroImage, "card") || null,
      dominantColor: null,
      authorName: blogByline(p.authors).replace(/^By\s+/i, "") || null,
      readTimeMins: p.readTime ?? null,
      visibility: "public", // blog API already returns published/public only
    }));
  } catch {
    return [];
  }
}

/**
 * Mount once (protected layout). Re-syncs when tickets or unread change. iOS
 * only — Android home widgets are a separate effort. No-op if no native backend
 * is registered (web).
 */
export function useWidgetSync(): void {
  const { data: tickets } = useMyTickets();
  const { data: unreadCount = 0 } = useUnreadMessageCount();

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let cancelled = false;
    (async () => {
      const [ticketSources, blogSources] = await Promise.all([
        buildTicketSources((tickets ?? []) as unknown as { [k: string]: unknown }[]),
        buildBlogSources(),
      ]);
      if (cancelled) return;
      await syncWidgets({
        tickets: ticketSources,
        blog: blogSources,
        // Own-data social glance is unread-driven for now; richer activity
        // (new followers) can be added here once a safe activity source exists.
        social: [],
        unreadCount,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tickets, unreadCount]);
}
