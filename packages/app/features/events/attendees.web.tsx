"use client";

/**
 * Event Attendees Screen — WEB port of the native host roster
 * (`app/(protected)/events/[id]/attendees.tsx`).
 *
 * Law 1 (data flow is sacred): consumes the EXACT same server contract as
 * native — `ticketsApi.getEventTicketsPaginated` via a TanStack
 * `useInfiniteQuery` keyed identically `["event-attendees", eventId, status,
 * search]`. Search keystrokes are debounced 200ms with `@tanstack/react-pacer`
 * (`useDebouncedValue`) just like native so we don't hammer the edge fn. The
 * server gates PII per role and returns the caller's effective `role`; we
 * surface the "scanner view" subtitle and the capacity count straight from the
 * response (`total`).
 *
 * Law 2 (web lists = TanStack Virtual): the roster renders through
 * `@tanstack/react-virtual` over a scroll container, with infinite scroll wired
 * off the last virtual item (mirrors home/screen.web.tsx) — never FlatList /
 * FlashList / LegendList.
 *
 * Law 3 (presentation): raw semantic HTML + Tailwind only (NativeWind interop is
 * off). Sticky glass header ("Attendees" + capacity) like legal-page.web.tsx,
 * user-row list like blocked.web.tsx, avatars are rounded squares (never
 * circles). Screen-local UI state (status filter + search input) lives in a
 * tiny Zustand store, never useState. Navigation via Solito; id via useParams.
 *
 * The native write-side affordances (export CSV, broadcast, comp, refund
 * selection) are intentionally out of scope for this read-only roster port —
 * the read path (list + search + filters + capacity + role + states) is ported
 * faithfully.
 */

import { useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  CheckCircle2,
  Circle,
  XCircle,
  ArrowLeftRight,
  Ban,
  X,
} from "lucide-react";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import {
  useAttendeesStore,
  type AttendeesStatusFilter,
} from "@dvnt/app/lib/stores/attendees-store";

const FILTERS: { value: AttendeesStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Unscanned" },
  { value: "scanned", label: "Scanned" },
  { value: "refunded", label: "Refunded" },
  { value: "transfer_pending", label: "Transferring" },
  { value: "void", label: "Void" },
];

function statusBadge(status: string): {
  Icon: typeof CheckCircle2;
  color: string;
  label: string;
} {
  switch (status) {
    case "scanned":
      return { Icon: CheckCircle2, color: "#22C55E", label: "Scanned" };
    case "refunded":
      return { Icon: XCircle, color: "#FC253A", label: "Refunded" };
    case "transfer_pending":
      return { Icon: ArrowLeftRight, color: "#F59E0B", label: "Transferring" };
    case "void":
      return { Icon: Ban, color: "rgba(255,255,255,0.4)", label: "Void" };
    case "active":
    default:
      return {
        Icon: Circle,
        color: "rgba(255,255,255,0.45)",
        label: "Unscanned",
      };
  }
}

const ROW_HEIGHT = 84; // 72px row + 12px gap

function AttendeeRow({ item }: { item: TicketRecord }) {
  const router = useRouter();
  const { Icon, color, label } = statusBadge(item.status);
  const tier = item.ticket_type_name || "General";
  const gaColor = tierAccent("ga");
  // Native long-presses to a selection refund flow; on web a row click that
  // resolves to a known username opens the profile (project nav convention).
  const username = item.username;
  const displayName = username
    ? `@${username}`
    : `Ticket ${String(item.id).slice(0, 8)}`;
  const initial = (username || item.qr_token || "?").slice(0, 1).toUpperCase();

  return (
    <div
      onClick={() => {
        if (username) router.push(`/profile/${username}`);
      }}
      role="button"
      className={`flex items-center gap-3 rounded-xl border border-white/8 bg-white/4 px-3 py-3 ${
        username ? "cursor-pointer active:bg-white/6" : ""
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/6 text-[13px] font-bold tracking-wide text-white/70">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{displayName}</p>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="rounded-lg border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ borderColor: gaColor, color: gaColor }}
          >
            {tier}
          </span>
          {item.purchase_amount_cents != null ? (
            <span className="text-[13px] text-white/40">
              ${(item.purchase_amount_cents / 100).toFixed(2)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color }}
        >
          <Icon size={14} color={color} />
          {label}
        </span>
        {item.checked_in_at ? (
          <span className="text-[13px] text-white/40">
            {new Date(item.checked_in_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function AttendeesScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);

  const statusFilter = useAttendeesStore((s) => s.statusFilter);
  const setStatusFilter = useAttendeesStore((s) => s.setStatusFilter);
  const searchInput = useAttendeesStore((s) => s.searchInput);
  const setSearchInput = useAttendeesStore((s) => s.setSearchInput);

  // Debounce 200ms so each keystroke doesn't hit the edge fn (mirrors native).
  const [searchDebounced] = useDebouncedValue(searchInput, { wait: 200 });

  const query = useInfiniteQuery({
    queryKey: ["event-attendees", eventId, statusFilter, searchDebounced.trim()],
    queryFn: ({ pageParam = 1 }) =>
      ticketsApi.getEventTicketsPaginated(String(eventId), {
        page: pageParam as number,
        pageSize: 50,
        status: statusFilter,
        search: searchDebounced.trim(),
      }),
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    initialPageParam: 1,
    enabled: Number.isFinite(eventId) && eventId > 0,
  });

  const flat = useMemo(
    () => query.data?.pages.flatMap((p) => p.tickets) ?? [],
    [query.data],
  );
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? null;
  const role = query.data?.pages[0]?.role ?? null;

  const search = searchDebounced.trim();

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Infinite scroll off the last virtual item (mirrors home/screen.web.tsx).
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (
      last &&
      last.index >= flat.length - 6 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      query.fetchNextPage();
    }
  }, [items, flat.length, query]);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky glass header — title + capacity / role subtitle. */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-tight">Attendees</h1>
          {total != null ? (
            <p className="mt-0.5 text-xs text-white/45">
              {total} total
              {role === "scanner" ? " · scanner view" : ""}
            </p>
          ) : null}
        </div>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
          <Search size={16} color="rgba(255,255,255,0.45)" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ticket id"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/35 outline-none"
          />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 py-3">
          {FILTERS.map((f) => {
            const selected = statusFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  selected
                    ? "border-white bg-white text-black"
                    : "border-white/12 text-white/70 active:bg-white/5"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* List / states */}
        {query.isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
            <p className="mt-4 text-sm text-white/40">Loading attendees...</p>
          </div>
        ) : query.isError ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-white/40">
              Couldn&apos;t load attendees. Try again.
            </p>
            <button
              onClick={() => query.refetch()}
              className="mt-4 rounded-lg bg-white/8 px-4 py-2 text-sm font-semibold text-white active:bg-white/12"
            >
              Retry
            </button>
          </div>
        ) : flat.length === 0 ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-white/40">
              {search
                ? `No matches for "${search}".`
                : "No attendees in this filter yet."}
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 220px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {items.map((vItem) => {
                const item = flat[vItem.index];
                if (!item) return null;
                return (
                  <div
                    key={item.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <AttendeeRow item={item} />
                  </div>
                );
              })}
            </div>

            {query.isFetchingNextPage ? (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

export default AttendeesScreen;
