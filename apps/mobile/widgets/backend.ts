/**
 * Native widget backend (iOS). Bridges the app's SAFE-ONLY dataset to the
 * expo-widgets timeline + Live Activity APIs:
 *   - caches remote flyer/cover/avatar images into the App Group's
 *     widgetsDirectory (Image renders local files, not URLs),
 *   - builds a rotating TIMELINE per widget so the carousel visibly cycles
 *     (each entry advances the shown item), and
 *   - drives the event Live Activity.
 *
 * Registered with the shared, native-free sync layer via
 * registerWidgetBackend / registerLiveActivityBackend (see index.ts). No spicy
 * content can reach here — filtering already happened in buildWidgetDataset /
 * buildEventLiveActivityState.
 */
import { Platform } from "react-native";
import {
  EventLiveActivity,
} from "./live-activity";
import { BlogWidget } from "./blog-widget";
import { SocialWidget } from "./social-widget";
import { TicketsWidget } from "./tickets-widget";
import type { BlogCard, SocialCard, TicketCard } from "./widget-props";
import type {
  EventLiveActivityState,
  LiveActivityBackend,
  WidgetBackend,
  WidgetDataset,
} from "@dvnt/app/lib/widgets";

// expo-widgets shared image directory (App Group container).
import { widgetsDirectory, type LiveActivity } from "expo-widgets";

// expo-file-system's SDK-56 surface varies; use it defensively so a mismatch
// degrades to the branded placeholder rather than throwing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FileSystem: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FileSystem = require("expo-file-system");
} catch {
  FileSystem = null;
}

const isIOS = Platform.OS === "ios";
const ROTATE_MINUTES = 20; // carousel advance cadence (WidgetKit refresh budget)
const MAX_ENTRIES = 12;

function hash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Download a remote image into the App Group; returns a local file path or null. */
async function cacheImage(url: string | null | undefined): Promise<string | null> {
  if (!url || !isIOS || !widgetsDirectory || !FileSystem) return null;
  try {
    const dest = `${widgetsDirectory}/img-${hash(url)}.img`;
    if (typeof FileSystem.downloadAsync === "function") {
      const res = await FileSystem.downloadAsync(url, dest);
      return res?.uri ?? dest;
    }
    // New API fallback: File(dest).downloadFileAsync(url) style — best effort.
    if (FileSystem.File && typeof FileSystem.File === "function") {
      const file = new FileSystem.File(dest);
      if (typeof file.downloadFileAsync === "function") {
        await file.downloadFileAsync(url);
        return file.uri ?? dest;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function attachImage<T extends { imagePath?: string | null }>(
  card: T,
  url: string | null | undefined,
): Promise<T> {
  card.imagePath = await cacheImage(url);
  return card;
}

/** Build a rotating timeline: entry i shows item (i % count), staggered in time. */
function rotatingTimeline<P>(count: number, makeProps: (index: number) => P) {
  const now = Date.now();
  const n = Math.max(1, count);
  const steps = Math.min(Math.max(n, 1), MAX_ENTRIES);
  const entries: { date: Date; props: P }[] = [];
  for (let i = 0; i < steps; i++) {
    entries.push({ date: new Date(now + i * ROTATE_MINUTES * 60_000), props: makeProps(i % n) });
  }
  return entries;
}

// ── Widget backend ───────────────────────────────────────────────────────────
const widgetBackend: WidgetBackend = {
  async write(dataset: WidgetDataset) {
    if (!isIOS) return;

    // Tickets
    const ticketCards: TicketCard[] = await Promise.all(
      dataset.tickets.map((t) => attachImage<TicketCard>({ ...t }, t.flyerThumbUrl)),
    );
    TicketsWidget.updateTimeline(
      rotatingTimeline(ticketCards.length, (index) => ({
        cards: ticketCards,
        index,
        suppressed: dataset.ticketsSuppressed,
      })),
    );

    // Blog
    const blogCards: BlogCard[] = await Promise.all(
      dataset.blog.map((b) => attachImage<BlogCard>({ ...b }, b.coverUrl)),
    );
    BlogWidget.updateTimeline(
      rotatingTimeline(blogCards.length, (index) => ({ cards: blogCards, index })),
    );

    // Social
    const socialCards: SocialCard[] = await Promise.all(
      dataset.social.map((s) => attachImage<SocialCard>({ ...s }, s.avatarUrl)),
    );
    SocialWidget.updateTimeline(
      rotatingTimeline(Math.max(socialCards.length, 1), (index) => ({
        cards: socialCards,
        index,
        unreadCount: dataset.unreadCount,
      })),
    );
  },
};

// ── Live Activity backend ────────────────────────────────────────────────────
let current: LiveActivity<EventLiveActivityState & { imagePath?: string | null }> | null = null;

async function toLiveProps(state: EventLiveActivityState) {
  const imagePath = state.neutral ? null : await cacheImage(null); // hero cached elsewhere; neutral => none
  return { ...state, imagePath };
}

const liveActivityBackend: LiveActivityBackend = {
  isSupported() {
    return isIOS;
  },
  async start(state) {
    if (!isIOS) return;
    const props = await toLiveProps(state);
    try {
      // Refresh an existing activity instead of stacking duplicates.
      const existing = EventLiveActivity.getInstances?.() ?? [];
      if (existing.length) {
        current = existing[0];
        await current.update(props);
        return;
      }
    } catch {
      /* fall through to start */
    }
    current = EventLiveActivity.start(props, state.deepLink);
  },
  async update(state) {
    if (!isIOS) return;
    const props = await toLiveProps(state);
    const activity = current ?? EventLiveActivity.getInstances?.()[0] ?? null;
    if (activity) {
      current = activity;
      await activity.update(props);
    } else {
      current = EventLiveActivity.start(props, state.deepLink);
    }
  },
  async end() {
    if (!isIOS) return;
    try {
      const all = EventLiveActivity.getInstances?.() ?? (current ? [current] : []);
      await Promise.all(all.map((a) => a.end("immediate")));
    } finally {
      current = null;
    }
  },
};

export { liveActivityBackend, widgetBackend };
