"use client";

/**
 * Host Multi-Event Dashboard — web (port of native
 * `app/(protected)/events/host.tsx`).
 *
 * Law 1 (data is sacred): wires the EXACT native data flow — TanStack Query
 * `useQuery({ queryKey: ["host-dashboard"], queryFn: getHostDashboard })` from
 * `@dvnt/app/lib/api/privileged`, plus `tierAccent` from
 * `@dvnt/app/lib/theme/tier-colors`. Stats row + TONIGHT / UPCOMING /
 * collapsible DRAFTS + PAST sections mirror native 1:1.
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) —
 * no <View>/<Text>. The event list is rendered via TanStack Virtual (never
 * FlatList/FlashList). Event thumbs are rounded squares, never pills (status
 * uses a square-ish badge). Section collapse state lives in a Zustand store
 * (never useState). Sticky header, content max-w-2xl, bg #06070d, accent
 * cyan #3FDCFF.
 *
 * Navigation via solito `useRouter`. Native taps route to single-event admin
 * surfaces; web routes the per-event tap to `/feed/events/{id}/organizer`
 * (TONIGHT + UPCOMING + DRAFTS + PAST). The empty-state CTA pushes
 * `/feed/events/create`.
 */

import { useCallback, useMemo, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  Ticket,
  TrendingUp,
} from "lucide-react";
import {
  getHostDashboard,
  type HostDashboardEvent,
} from "@dvnt/app/lib/api/privileged";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import { useHostSectionsStore } from "./host-sections-store";

function formatMoney(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString()}`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Tonight · ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-white/8 bg-white/4 p-3">
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: `${accent}22` }}
      >
        {icon}
      </span>
      <p className="mt-2 text-[22px] font-bold tracking-tight text-white">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
        {label}
      </p>
    </div>
  );
}

function EventRow({
  event,
  onPress,
  prominent = false,
}: {
  event: HostDashboardEvent;
  onPress: () => void;
  prominent?: boolean;
}) {
  const sold = event.sold_count;
  const cap = event.capacity ?? null;
  const pct =
    cap && cap > 0 ? Math.min(100, Math.round((sold / cap) * 100)) : null;

  const pctColor =
    pct != null && pct >= 95
      ? "#FC253A"
      : pct != null && pct >= 75
        ? "#F59E0B"
        : "rgba(255,255,255,0.65)";

  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex w-full items-center gap-3 px-2 py-3 text-left active:bg-white/5 ${
        prominent
          ? "rounded-xl border border-[#FF5BFC]/12 bg-[#FF5BFC]/4"
          : ""
      }`}
    >
      {/* Thumb — rounded square, never a pill */}
      {event.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.cover_image_url}
          alt={event.title || "Event"}
          className="h-14 w-14 shrink-0 rounded-xl object-cover bg-white/8"
        />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-[#3FDCFF]/18 bg-[#3FDCFF]/8">
          <Calendar size={20} color="rgba(63,220,255,0.65)" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">
          {event.title || "Untitled event"}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/45">
          {formatRelativeDate(event.start_date)}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-white/65">
            {sold}
            {cap ? `/${cap}` : ""} sold
          </span>
          {event.gross_cents > 0 ? (
            <>
              <span className="text-xs text-white/30">·</span>
              <span className="text-xs font-medium text-white/65">
                {formatMoney(event.gross_cents)}
              </span>
            </>
          ) : null}
          {pct != null ? (
            <>
              <span className="text-xs text-white/30">·</span>
              <span
                className="text-xs font-medium"
                style={{ color: pctColor }}
              >
                {pct}%
              </span>
            </>
          ) : null}
          {event.status === "cancelled" ? (
            <span className="ml-1 rounded-md bg-[#FC253A]/16 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#FC8FAA]">
              Cancelled
            </span>
          ) : null}
        </span>
      </span>

      <ChevronRight size={18} className="shrink-0 text-white/25" />
    </button>
  );
}

function CollapsibleSection({
  storeKey,
  title,
  events,
  onEventPress,
}: {
  storeKey: string;
  title: string;
  events: HostDashboardEvent[];
  onEventPress: (id: number) => void;
}) {
  const open = useHostSectionsStore((s) => !!s.open[storeKey]);
  const toggle = useHostSectionsStore((s) => s.toggle);
  if (events.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(storeKey)}
        className="flex w-full items-center justify-between pr-2"
      >
        <span className="px-2 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">
          {title} · {events.length}
        </span>
        {open ? (
          <ChevronDown size={16} className="text-white/45" />
        ) : (
          <ChevronRight size={16} className="text-white/45" />
        )}
      </button>
      {open
        ? events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              onPress={() => onEventPress(e.id)}
            />
          ))
        : null}
    </div>
  );
}

export function HostScreen() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["host-dashboard"],
    queryFn: getHostDashboard,
    staleTime: 30_000,
  });

  // Native routes per-event taps to the single-event admin surfaces; on web
  // every event tap lands on the per-event organizer surface.
  const goEvent = useCallback(
    (id: number) => router.push(`/feed/events/${id}/organizer`),
    [router],
  );

  const data = q.data;

  // Flatten TONIGHT + UPCOMING into one virtualized list (native renders
  // them as two labelled groups; we keep the labels as header rows).
  const rows = useMemo(() => {
    const list: Array<
      | { kind: "label"; key: string; label: string }
      | {
          kind: "event";
          key: string;
          event: HostDashboardEvent;
          prominent: boolean;
        }
    > = [];
    if (!data) return list;
    if (data.tonight.length > 0) {
      list.push({ kind: "label", key: "label-tonight", label: "TONIGHT" });
      for (const e of data.tonight) {
        list.push({
          kind: "event",
          key: `tonight-${e.id}`,
          event: e,
          prominent: true,
        });
      }
    }
    if (data.upcoming.length > 0) {
      list.push({ kind: "label", key: "label-upcoming", label: "UPCOMING" });
      for (const e of data.upcoming) {
        list.push({
          kind: "event",
          key: `upcoming-${e.id}`,
          event: e,
          prominent: false,
        });
      }
    }
    return list;
  }, [data]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]?.kind === "label" ? 48 : 80),
    overscan: 8,
  });

  const empty =
    !!data &&
    data.tonight.length === 0 &&
    data.upcoming.length === 0 &&
    data.drafts.length === 0 &&
    data.past.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="flex-1 text-[17px] font-semibold">Host Dashboard</h1>
      </div>

      {q.isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
        </div>
      ) : q.isError || !data ? (
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-4 px-6 py-24 text-center">
          <p className="text-sm text-white/40">
            Couldn&apos;t load. Retry below.
          </p>
          <button
            type="button"
            onClick={() => q.refetch()}
            className="rounded-full border border-[#8A40CF]/40 bg-[#8A40CF]/18 px-5 py-2.5 text-sm font-semibold text-[#C084FC]"
          >
            Retry
          </button>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-2 pb-12">
          {/* Stats row */}
          <div className="flex gap-2 px-2 py-3">
            <StatCard
              label="This month"
              value={String(data.stats.monthSold)}
              icon={<Ticket size={16} color={tierAccent("ga")} />}
              accent={tierAccent("ga")}
            />
            <StatCard
              label="Revenue"
              value={formatMoney(data.stats.monthRevenueCents)}
              icon={<TrendingUp size={16} color={tierAccent("table")} />}
              accent={tierAccent("table")}
            />
            <StatCard
              label="Scan rate"
              value={
                data.stats.scanRate != null
                  ? `${data.stats.scanRate}%`
                  : "—"
              }
              icon={<Calendar size={16} color={tierAccent("free")} />}
              accent={tierAccent("free")}
            />
          </div>

          {empty ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <p className="text-[17px] font-semibold text-white">
                No events yet
              </p>
              <p className="text-sm text-white/40">
                Create your first event to see it here.
              </p>
              <button
                type="button"
                onClick={() => router.push("/feed/events/create")}
                className="mt-4 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black"
              >
                Create an event
              </button>
            </div>
          ) : (
            <>
              {/* TONIGHT + UPCOMING — TanStack Virtual */}
              {rows.length > 0 ? (
                <div
                  ref={parentRef}
                  className="overflow-y-auto"
                  style={{ maxHeight: "calc(100dvh - 260px)" }}
                >
                  <div
                    className="relative w-full"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    {virtualizer.getVirtualItems().map((item) => {
                      const row = rows[item.index];
                      if (!row) return null;
                      return (
                        <div
                          key={row.key}
                          data-index={item.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${item.start}px)`,
                          }}
                        >
                          {row.kind === "label" ? (
                            <p className="px-2 pt-6 pb-2 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                              {row.label}
                            </p>
                          ) : (
                            <EventRow
                              event={row.event}
                              prominent={row.prominent}
                              onPress={() => goEvent(row.event.id)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* DRAFTS + PAST — collapsible (Zustand-backed) */}
              <CollapsibleSection
                storeKey="drafts"
                title="DRAFTS"
                events={data.drafts}
                onEventPress={goEvent}
              />
              <CollapsibleSection
                storeKey="past"
                title="PAST"
                events={data.past}
                onEventPress={goEvent}
              />
            </>
          )}
        </main>
      )}
    </div>
  );
}

export default HostScreen;
