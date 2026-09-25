/**
 * Serializable props passed from the app into each widget's timeline (they cross
 * the app→extension process boundary, so: JSON-only, no functions). The backend
 * (backend.ts) maps the SAFE-ONLY WidgetDataset into these and adds `imagePath`
 * — a local file in the App Group's widgetsDirectory, since @expo/ui `Image`
 * renders local files (`uiImage`), not remote URLs.
 */
import type {
  EventLiveActivityState,
  WidgetBlogEntry,
  WidgetSocialEntry,
  WidgetTicketEntry,
} from "@dvnt/app/lib/widgets";

export type TicketCard = WidgetTicketEntry & { imagePath?: string | null };
export type BlogCard = WidgetBlogEntry & { imagePath?: string | null };
export type SocialCard = WidgetSocialEntry & { imagePath?: string | null };

/** Tickets widget timeline entry. `index` selects the card → drives the carousel. */
export type TicketsWidgetProps = {
  cards: TicketCard[];
  index: number;
  suppressed: boolean;
};

export type BlogWidgetProps = {
  cards: BlogCard[];
  index: number;
};

export type SocialWidgetProps = {
  cards: SocialCard[];
  index: number;
  unreadCount: number;
};

export type LiveWidgetProps = EventLiveActivityState & { imagePath?: string | null };
