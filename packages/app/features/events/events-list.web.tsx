/**
 * Events home — WEB (@dvnt/app/features/events/events-list). Mirrors the mobile
 * events screen: date header + NSFW toggle, search bar with filter button, tabs
 * (Upcoming / For You / All / Past), category filter pills, then a spotlight
 * carousel (promoted) + curated collection rows (This Weekend / Trending /
 * Upcoming). SHARED data (useEvents + useSpotlightFeed) and SHARED UI state
 * (useEventsScreenStore — no local useState). The native screen pulls maps/media
 * that crash on web, so this is the web view.
 */
import { useMemo, useRef, useEffect } from "react";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  Calendar,
  MapPin,
  Search,
  X,
  SlidersHorizontal,
  TrendingUp,
  Sparkles,
  CalendarDays,
  Globe,
  Moon,
  Users,
  Lock,
  Ticket,
  Heart,
  Zap,
} from "lucide-react";
import {
  useEvents,
  useForYouEvents,
  useToggleEventLike,
  type Event,
} from "@dvnt/app/lib/hooks/use-events";
import { useEventsFeedRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import {
  useSpotlightFeed,
  usePromotedEventIds,
} from "@dvnt/app/lib/hooks/use-promotions";
import { useEventsScreenStore } from "@dvnt/app/lib/stores/events-screen-store";
import { slugify } from "@dvnt/app/lib/slug";

const TABS = ["Upcoming", "For You", "All", "Past"] as const;

const FILTERS = [
  { id: "in_city", label: "In City", Icon: MapPin, color: "#3EA4E5" },
  { id: "online", label: "Online", Icon: Globe, color: "#10B981" },
  { id: "tonight", label: "Tonight", Icon: Moon, color: "#8B5CF6" },
  { id: "this_weekend", label: "Weekend", Icon: Calendar, color: "#F59E0B" },
  { id: "friends_going", label: "Friends Going", Icon: Users, color: "#EC4899" },
  { id: "invite_only", label: "Invite-only", Icon: Lock, color: "#EF4444" },
] as const;

function shortDate(iso?: string): string {
  if (!iso) return "Date TBA";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Date TBA";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const dateOf = (e: Event) => new Date(e.fullDate || e.date || "");

function weekendRange() {
  const now = new Date();
  const dow = now.getDay();
  const satStart = new Date(now);
  satStart.setDate(now.getDate() + ((6 - dow + 7) % 7));
  satStart.setHours(0, 0, 0, 0);
  const sunEnd = new Date(satStart);
  sunEnd.setDate(satStart.getDate() + 1);
  sunEnd.setHours(23, 59, 59, 999);
  return [satStart, sunEnd] as const;
}

export function EventsListScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // Phase 2 — live propagation: patch any event card in place when its row
  // changes elsewhere (host edit / cancel), no refetch/flicker.
  useEventsFeedRealtime();
  const { data: events, isLoading } = useEvents();
  // Personalized "For You" feed — separate query (15min cache native-side).
  const { data: forYouEvents, isLoading: forYouLoading } = useForYouEvents();
  const { data: spotlight } = useSpotlightFeed();
  // Promoted/sponsored event IDs — boost to top + badge them.
  const { data: promotedIds } = usePromotedEventIds();
  // Like/save mutation — real optimistic mutation, shared with native.
  const toggleLike = useToggleEventLike();

  const searchQuery = useEventsScreenStore((s) => s.searchQuery);
  const setSearchQuery = useEventsScreenStore((s) => s.setSearchQuery);
  const activeTab = useEventsScreenStore((s) => s.activeTab);
  const setActiveTab = useEventsScreenStore((s) => s.setActiveTab);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeFilters = useEventsScreenStore((s) => s.activeFilters) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toggleFilter = useEventsScreenStore((s) => s.toggleFilter) as any;
  const nsfwFilter = useEventsScreenStore((s) => s.nsfwFilter);
  const setNsfwFilter = useEventsScreenStore((s) => s.setNsfwFilter);
  const filterOpen = useEventsScreenStore((s) => s.filterSheetVisible);
  const setFilterOpen = useEventsScreenStore((s) => s.setFilterSheetVisible);
  const clearAllFilters = useEventsScreenStore((s) => s.clearAllFilters);

  const open = (title?: string | null) =>
    router.push(`/events/${slugify(title)}`);

  const q = searchQuery.trim().toLowerCase();
  const now = new Date();
  const [satStart, sunEnd] = weekendRange();

  // Whether the user is actively searching/filtering — native falls back to the
  // filtered "All Events" set on the For You tab when this is true so pills +
  // search always apply.
  const hasActiveFilters = q.length > 0 || activeFilters.length > 0;

  // Merge the is_promoted flag from usePromotedEventIds into every event, then
  // boost promoted events to the top (native's promoted/sponsored ordering).
  const withPromotion = useMemo<Event[]>(() => {
    // promotedIds is typed Set<number>, but query persistence serializes a Set to
    // a plain object/array (JSON has no Set) — coerce back to a real Set so .has exists.
    const promoted: Set<number> =
      promotedIds instanceof Set
        ? promotedIds
        : new Set<number>(
            Array.isArray(promotedIds)
              ? (promotedIds as number[])
              : promotedIds && typeof promotedIds === "object"
                ? (Object.values(promotedIds) as number[])
                : [],
          );
    const list = ((events ?? []) as Event[]).filter((e) => e.title);
    const flagged: Event[] = list.map((e) => ({
      ...e,
      isPromoted: promoted.has(parseInt(e.id)) || e.isPromoted || false,
    }));
    // Stable sort: promoted first, original order preserved otherwise.
    return flagged
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const pa = a.e.isPromoted ? 1 : 0;
        const pb = b.e.isPromoted ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return a.i - b.i;
      })
      .map(({ e }) => e);
  }, [events, promotedIds]);

  const all = withPromotion;

  // "For You" personalized feed, also promotion-flagged for the badge.
  const forYou = useMemo<Event[]>(
    () =>
      ((forYouEvents ?? []) as Event[])
        .filter((e) => e.title)
        .map((e) => ({
          ...e,
          isPromoted: promotedIds?.has(parseInt(e.id)) ?? e.isPromoted ?? false,
        })),
    [forYouEvents, promotedIds],
  );

  // Search + tab + category filtering (client-side).
  const filtered = useMemo(() => {
    // For You tab (index 1): use the personalized feed unless the user is
    // actively searching/filtering — then fall back to the filtered set.
    const base =
      activeTab === 1 && !hasActiveFilters ? forYou : all;
    return base.filter((e) => {
      if (q) {
        const hay = `${e.title} ${e.location ?? ""} ${e.host?.username ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const d = dateOf(e);
      const valid = !Number.isNaN(d.getTime());
      if (activeTab === 0 && valid && d < now) return false; // Upcoming
      if (activeTab === 3 && valid && d >= now) return false; // Past
      for (const f of activeFilters) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (f === "online" && !(e as any).isOnline) return false;
        if (f === "tonight") {
          const td = new Date();
          if (!valid || d.toDateString() !== td.toDateString()) return false;
        }
        if (f === "this_weekend" && (!valid || d < satStart || d > sunEnd))
          return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, forYou, hasActiveFilters, q, activeTab, activeFilters]);

  const collections = useMemo(() => {
    const weekend = all.filter((e) => {
      const d = dateOf(e);
      return !Number.isNaN(d.getTime()) && d >= satStart && d <= sunEnd;
    });
    const trending = [...all]
      .sort((a, b) => (b.totalAttendees ?? 0) - (a.totalAttendees ?? 0))
      .slice(0, 8);
    const fresh = all
      .filter((e) => {
        const d = dateOf(e);
        return !Number.isNaN(d.getTime()) && d >= now;
      })
      .slice(0, 8);
    return { weekend, trending, fresh };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const browsing = q.length > 0 || activeFilters.length > 0 || activeTab !== 0;
  const today = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="min-h-[100dvh] bg-[#02030A] text-white">
      <div className="mx-auto max-w-3xl px-4 pt-4 pb-28">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-white/45 font-semibold">
              {today}
            </div>
            <h1 className="text-3xl font-extrabold mt-0.5">Events</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* "My tickets" is member-only — a signed-out visitor has none, so
                hide it entirely (PROMPT 13 §4: gate member affordances). */}
            {isAuthenticated ? (
              <button
                onClick={() => router.push("/events/my-tickets")}
                className="h-10 px-3.5 rounded-xl border border-white/12 bg-white/[0.06] flex items-center gap-1.5 text-sm font-semibold"
              >
                <Ticket size={16} color="#379ED8" />
                Tickets
              </button>
            ) : null}
            {/* SPICY toggle is a member-only affordance — hidden entirely for
                signed-out users (PROMPT 13 §4 / 13B: no leak). */}
            {isAuthenticated ? (
              <button
                onClick={() => setNsfwFilter(nsfwFilter === true ? false : true)}
                aria-label="Toggle spicy events"
                className="w-10 h-10 rounded-xl border border-white/12 flex items-center justify-center text-lg"
                style={{
                  backgroundColor:
                    nsfwFilter === true
                      ? "rgba(153,27,27,0.3)"
                      : "rgba(255,255,255,0.06)",
                }}
              >
                {nsfwFilter === true ? "😈" : "😇"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Search + filter popover */}
        <div className="relative flex items-center gap-2 mt-3">
          <div className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl border border-white/12 bg-white/[0.05]">
            <Search size={18} color="rgba(255,255,255,0.5)" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events, venues, hosts…"
              className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
            />
            {searchQuery ? (
              <button onClick={() => setSearchQuery("")} aria-label="Clear">
                <X size={16} color="rgba(255,255,255,0.5)" />
              </button>
            ) : null}
          </div>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            aria-label="Filters"
            className="relative w-11 h-11 rounded-xl border border-white/12 bg-white/[0.05] flex items-center justify-center"
          >
            <SlidersHorizontal size={18} color="#fff" />
            {activeFilters.length > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-lg bg-[#379ED8] text-black text-[9px] font-bold flex items-center justify-center">
                {activeFilters.length}
              </span>
            ) : null}
          </button>

          {filterOpen ? (
            <>
              {/* click-away backdrop */}
              <button
                aria-label="Close filters"
                onClick={() => setFilterOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-white/12 bg-[#0b0d16] p-3 shadow-2xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">Filters</span>
                  {activeFilters.length > 0 ? (
                    <button
                      onClick={() => clearAllFilters()}
                      className="text-xs text-[#379ED8] font-medium"
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {FILTERS.map((f) => {
                    const active = activeFilters.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        onClick={() => toggleFilter(f.id)}
                        className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm font-medium border"
                        style={{
                          backgroundColor: active ? `${f.color}22` : "rgba(255,255,255,0.05)",
                          borderColor: active ? f.color : "rgba(255,255,255,0.12)",
                          color: active ? f.color : "rgba(255,255,255,0.75)",
                        }}
                      >
                        <f.Icon size={13} color={active ? f.color : "rgba(255,255,255,0.6)"} />
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
          {TABS.map((t, i) => {
            const active = activeTab === i;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(i)}
                className={`shrink-0 px-3.5 h-8 rounded-lg text-sm font-semibold ${
                  active ? "bg-white text-black" : "bg-white/8 text-white/70"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="mt-5">
          {(isLoading || (activeTab === 1 && forYouLoading)) &&
          filtered.length === 0 ? (
            <p className="text-white/45 py-16 text-center">Loading events…</p>
          ) : (
            <>
              {!browsing && spotlight && spotlight.length > 0 ? (
                <Spotlight items={spotlight} onOpen={open} />
              ) : null}
              {!browsing ? (
                <>
                  <EventRow title="This Weekend" Icon={CalendarDays} events={collections.weekend} onOpen={open} />
                  <EventRow title="Trending" Icon={TrendingUp} events={collections.trending} onOpen={open} />
                </>
              ) : null}

              {filtered.length === 0 ? (
                <p className="text-white/45 py-16 text-center">No events match.</p>
              ) : (
                <VirtualEventList
                  events={filtered}
                  onOpen={open}
                  onToggleLike={(e) =>
                    toggleLike.mutate({
                      eventId: e.id,
                      isLiked: e.isLiked ?? false,
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default EventsListScreen;

function videoFor(e: Event): string | undefined {
  if (e.flyerVideoUrl) return e.flyerVideoUrl;
  const v = (e.images ?? []).find(
    (m) => m.type === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(m.url),
  );
  return v?.url;
}

function formatLikes(likes: number): string {
  if (likes >= 1000) return `${(likes / 1000).toFixed(1)}k`;
  return likes.toString();
}

// TanStack Virtual window-scrolled list of large event cards — matches the
// home feed's virtualization strategy so long lists stay cheap on web.
function VirtualEventList({
  events,
  onOpen,
  onToggleLike,
}: {
  events: Event[];
  onOpen: (title?: string | null) => void;
  onToggleLike: (e: Event) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: events.length,
    // aspect-video card (~16:9) on a max-w-3xl column + 16px gap.
    estimateSize: () => 360,
    overscan: 6,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [events.length, virtualizer]);

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={listRef}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((item) => {
        const e = events[item.index];
        if (!e) return null;
        return (
          <div
            key={e.id}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 w-full"
            style={{
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              paddingBottom: 16,
            }}
          >
            <LargeEventCard
              event={e}
              onOpen={onOpen}
              onToggleLike={onToggleLike}
            />
          </div>
        );
      })}
    </div>
  );
}

// Large hero card — matches the mobile event card (full image/VIDEO background,
// gradient, title/date/location, price + RSVP). Single-column stack (not a grid).
function LargeEventCard({
  event: e,
  onOpen,
  onToggleLike,
}: {
  event: Event;
  onOpen: (title?: string | null) => void;
  onToggleLike: (e: Event) => void;
}) {
  const video = videoFor(e);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(e.title)}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onOpen(e.title);
      }}
      className="relative w-full rounded-2xl overflow-hidden aspect-video text-left bg-white/[0.04] cursor-pointer"
    >
      {video ? (
        <video
          src={video}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : e.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={e.image}
          alt={e.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-linear-to-br from-[#1A0A2E] via-[#874E9F]/50 to-[#02030A]" />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/25 to-transparent" />
      {/* Like / save — real useToggleEventLike mutation. Sibling of the card
          click handler; stopPropagation keeps it from navigating. */}
      <button
        type="button"
        aria-label={e.isLiked ? "Unlike event" : "Like event"}
        onClick={(ev) => {
          ev.stopPropagation();
          onToggleLike(e);
        }}
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 h-9 rounded-xl bg-black/45 backdrop-blur"
      >
        <Heart
          size={16}
          color={e.isLiked ? "#FF5BFC" : "#fff"}
          fill={e.isLiked ? "#FF5BFC" : "transparent"}
        />
        <span className="text-white text-sm font-medium">
          {formatLikes(e.likes ?? 0)}
        </span>
      </button>
      <div className="absolute top-3 left-3 flex items-center gap-1.5">
        {e.isPromoted ? (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/90 text-white text-[10px] font-bold uppercase tracking-wider">
            <Zap size={10} color="#fff" fill="#fff" />
            Promoted
          </span>
        ) : null}
        {e.category ? (
          <span className="px-2.5 py-1 rounded-lg bg-white/15 backdrop-blur text-white text-[10px] font-bold uppercase tracking-wider">
            {e.category}
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="flex items-center gap-1.5 text-[#379ED8] text-xs font-semibold">
          <Calendar size={14} />
          {shortDate(e.fullDate || e.date)}
        </div>
        <div className="text-2xl font-extrabold leading-tight mt-1 line-clamp-2">
          {e.title}
        </div>
        {e.location ? (
          <div className="flex items-center gap-1.5 text-white/75 text-sm mt-1">
            <MapPin size={14} />
            {e.location}
          </div>
        ) : null}
        <div className="flex items-center justify-between mt-3">
          <span className="px-3 py-1 rounded-lg bg-white/15 text-white text-sm font-medium">
            {e.price ? `$${e.price}` : "Free"}
            {e.totalAttendees ? ` · ${e.totalAttendees} going` : ""}
          </span>
          <span className="px-5 py-1.5 rounded-lg bg-[#3EA4E5] text-white text-sm font-bold">
            RSVP
          </span>
        </div>
      </div>
    </div>
  );
}

function EventCard({
  event: e,
  onOpen,
}: {
  event: Event;
  onOpen: (title?: string | null) => void;
}) {
  const img =
    e.image && !/post-video|\.(mp4|mov|webm)(\?|$)/i.test(e.image)
      ? e.image
      : "";
  return (
    <button onClick={() => onOpen(e.title)} className="text-left w-full">
      <div className="relative rounded-xl overflow-hidden aspect-square bg-white/[0.06]">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={e.title} className="w-full h-full object-cover" />
        ) : (
          // No cover → themed gradient with the title (consistent, never blank).
          <div className="absolute inset-0 flex items-center justify-center p-3 bg-linear-to-br from-[#1A0A2E] via-[#874E9F]/50 to-[#02030A]">
            <span className="text-center text-[15px] font-bold leading-snug line-clamp-4">
              {e.title}
            </span>
          </div>
        )}
      </div>
      <div className="text-[#379ED8] text-[11px] font-semibold mt-1.5">
        {shortDate(e.fullDate || e.date)}
      </div>
      <div className="text-sm font-semibold leading-snug line-clamp-2">
        {e.title}
      </div>
      {e.location ? (
        <div className="text-white/45 text-xs mt-0.5 truncate">{e.location}</div>
      ) : null}
    </button>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Spotlight({
  items,
  onOpen,
}: {
  items: any[];
  onOpen: (title?: string | null) => void;
}) {
  return (
    <section className="-mx-4 mb-6" aria-label="Featured">
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar px-4">
        {items.map((it, i) => (
          <button
            key={it.id ?? it.event_id ?? i}
            onClick={() => onOpen(it.title)}
            className="snap-center shrink-0 w-[85%] sm:w-[460px] relative rounded-2xl overflow-hidden aspect-video text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.spotlight_image || it.cover_image || it.image}
              alt={it.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <div className="flex items-center gap-1.5 text-[#379ED8] text-xs font-semibold">
                <Calendar size={13} />
                {shortDate(it.start_date || it.date)}
              </div>
              <div className="text-xl font-extrabold leading-tight mt-1 line-clamp-2">
                {it.title}
              </div>
              {it.location ? (
                <div className="flex items-center gap-1.5 text-white/70 text-sm mt-1">
                  <MapPin size={13} />
                  {it.location}
                </div>
              ) : null}
            </div>
            <span className="absolute top-3 left-3 px-2 py-0.5 rounded-lg bg-white/15 backdrop-blur text-white text-[10px] font-bold uppercase tracking-wider">
              Spotlight
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function EventRow({
  title,
  Icon,
  events,
  onOpen,
}: {
  title: string;
  Icon: typeof TrendingUp;
  events: Event[];
  onOpen: (title?: string | null) => void;
}) {
  if (!events || events.length === 0) return null;
  return (
    <section className="-mx-4 mb-6">
      <div className="flex items-center gap-2 px-4 mb-2">
        <Icon size={16} color="#379ED8" />
        <h2 className="text-base font-bold">{title}</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
        {events.map((e) => (
          <div key={e.id} className="shrink-0 w-44">
            <EventCard event={e} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </section>
  );
}
