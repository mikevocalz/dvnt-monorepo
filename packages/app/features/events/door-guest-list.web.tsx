"use client";

/**
 * Finding one person when the camera cannot.
 *
 * A scanner is useless against a dead phone, a screenshot that will not focus,
 * or a guest who bought on someone else's account. The list is the fallback,
 * and it checks in through the SAME path the camera does — `useScanTicket`
 * with the row's `qr_token`, which get-event-tickets returns to scanner-role
 * callers (functions/get-event-tickets/index.ts:383). One check-in path, one
 * CAS, one audit row, whichever way the door found the ticket.
 *
 * Search is client-side, deliberately. The server matches `qr_token` prefix
 * only — its own comment says name search "is left for a follow-up"
 * (index.ts:284-290) — and a door searches by NAME, because the person in
 * front of you can say their name and cannot read you their token. So the
 * roster is fetched whole and filtered here.
 *
 * That bounds the feature: `pageSize` is clamped server-side to 200
 * (index.ts:262), so this list covers the first 200 tickets of an event. The
 * Saturday door is ~100. A larger event needs either paging in this component
 * or the server-side name search that function defers; it is not silently
 * handled here.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import { Search, Check, X } from "lucide-react";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { qk } from "@dvnt/app/lib/query/keys";
import { isAdmissible, isListable } from "@dvnt/app/lib/tickets/ticket-access";
import {
  snapshotRoster,
  recallRoster,
  type CachedGuest,
} from "./door-roster-cache.web";

const ROSTER_CEILING = 200;

/**
 * The registry's roster key, not a private one.
 *
 * This used to be `["door-roster", eventId]`. `useScanTicket` invalidates
 * `qk.tickets.roster(eventId)` on every successful check-in — a different key
 * — so the guest list and the progress bar never refreshed after a scan. At a
 * door that means checking someone in from the camera and still seeing them in
 * "Not in yet", and a "still outside" count that only ever goes down when the
 * 30s staleTime happens to expire.
 */
export const doorRosterKey = (eventId: string) => qk.tickets.roster(eventId);
const ROW_ESTIMATE = 68;

type Filter = "all" | "in" | "out";

interface GuestListState {
  query: string;
  filter: Filter;
  setQuery: (query: string) => void;
  setFilter: (filter: Filter) => void;
}

/** Zustand, like every other piece of this screen's state. */
export const useGuestListStore = create<GuestListState>((set) => ({
  query: "",
  filter: "all",
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
}));

function minutesSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hr ago`;
}

export function DoorGuestList({
  eventId,
  onCheckIn,
  checkingInToken,
}: {
  eventId: string;
  /** Submits through the caller's useScanTicket — never a second write path. */
  onCheckIn: (qrToken: string) => void;
  checkingInToken: string | null;
}) {
  const query = useGuestListStore((s) => s.query);
  const filter = useGuestListStore((s) => s.filter);
  const setQuery = useGuestListStore((s) => s.setQuery);
  const setFilter = useGuestListStore((s) => s.setFilter);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: doorRosterKey(eventId),
    queryFn: () =>
      ticketsApi.getEventTicketsPaginated(eventId, {
        page: 1,
        pageSize: ROSTER_CEILING,
        status: "all",
      }),
    enabled: !!eventId,
    // The camera invalidates nothing here; a door re-reads the list when it
    // opens it, which is when someone is standing in front of them.
    staleTime: 30_000,
    // Run the query even with no connection, so a failure is an ERROR rather
    // than a pause. React Query's default `networkMode: "online"` parks an
    // offline query in `isPending` with `isError` false — which meant the
    // saved-roster fallback below, the one thing that exists for a venue with
    // no signal, never ran in the only situation it was written for. The scan
    // mutation already sets this for the same reason (use-tickets.ts).
    networkMode: "always",
  });

  /**
   * Live roster when there is one, the device's last snapshot when there is
   * not. A door with no signal and a reloaded phone otherwise has an empty
   * list and no way to look anyone up.
   */
  const cached = useMemo(() => (isError ? recallRoster(eventId) : null), [isError, eventId]);

  const tickets = useMemo(() => {
    const live = (data?.tickets ?? []).filter((t) => isListable(t.status));
    if (live.length) return live;
    // CachedGuest carries only the fields this list renders; the cast keeps
    // the row component honest about what it may read.
    return (cached?.guests ?? []).filter(
      (g) => isListable(g.status),
    ) as unknown as TicketRecord[];
  }, [data, cached]);

  // Snapshot every successful read, so the fallback is never older than the
  // last time this phone had signal.
  useEffect(() => {
    const live = (data?.tickets ?? []).filter((t) => isListable(t.status));
    if (live.length) snapshotRoster(eventId, live);
  }, [data, eventId]);

  // Counts describe ADMISSIBLE passes only. A refunded ticket is still listed
  // — staff need to find that person when they turn up insisting they have a
  // ticket — but it is not a guest who is coming, so it must not inflate the
  // denominator that tells the door how far through the queue they are.
  const counts = useMemo(() => {
    const admissible = tickets.filter((t) => isAdmissible(t.status));
    const checkedIn = admissible.filter((t) => !!t.checked_in_at).length;
    return {
      all: admissible.length,
      in: checkedIn,
      out: admissible.length - checkedIn,
    };
  }, [tickets]);

  /**
   * How many tickets each person holds, and which one a row is.
   *
   * On the real door 68 people hold 103 tickets — 22 of them hold more than
   * one, and one holds five. Every ticket is a separate QR and a separate
   * admission, so the list shows a row per TICKET, not per person. Without a
   * counter those rows are identical: staff check one in and cannot tell which
   * of the five it was, or how many that guest still has waiting.
   */
  const holdings = useMemo(() => {
    const total = new Map<string, number>();
    for (const t of tickets) {
      const k = t.holder_name ?? t.user_id ?? t.id;
      total.set(k, (total.get(k) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    const index = new Map<string, { n: number; of: number }>();
    for (const t of tickets) {
      const k = t.holder_name ?? t.user_id ?? t.id;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      index.set(t.id, { n, of: total.get(k) ?? 1 });
    }
    return index;
  }, [tickets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filter === "in" && !t.checked_in_at) return false;
      if (filter === "out" && t.checked_in_at) return false;
      if (!q) return true;
      return (
        (t.holder_name ?? "").toLowerCase().includes(q) ||
        (t.qr_token ?? "").toLowerCase().startsWith(q)
      );
    });
  }, [tickets, query, filter]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  const chip = useCallback(
    (key: Filter, label: string, count: number) => (
      <button
        key={key}
        type="button"
        aria-pressed={filter === key}
        onClick={() => setFilter(key)}
        className={`h-11 shrink-0 rounded-xl px-4 text-[13px] font-semibold ${
          filter === key
            ? "bg-white text-black"
            : "border border-white/15 text-white/75 active:bg-white/10"
        }`}
      >
        {label} {count}
      </button>
    ),
    [filter, setFilter],
  );

  return (
    <section className="mt-3">
      {cached && tickets.length ? (
        <p role="status" className="mb-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12px] font-medium text-[#78350F]">
          Offline — showing the list saved{" "}
          {Math.max(1, Math.round((Date.now() - cached.at) / 60_000))} min ago.
          Check-ins from other phones since then are not in it.
        </p>
      ) : null}

      <label className="flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
        <Search size={16} color="rgba(255,255,255,0.45)" aria-hidden />
        <span className="sr-only">Search guests</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name, or the ticket code"
          className="h-8 w-full bg-transparent text-[15px] text-white placeholder:text-white/35 focus:outline-none"
        />
      </label>

      <div
        role="group"
        aria-label="Filter guests"
        className="mt-2 flex gap-2 overflow-x-auto pb-1"
      >
        {chip("all", "All", counts.all)}
        {chip("in", "Checked in", counts.in)}
        {chip("out", "Not in yet", counts.out)}
      </div>

      {isLoading ? (
        <p role="status" className="py-10 text-center text-[14px] text-white/55">
          Loading tonight&rsquo;s guests…
        </p>
      ) : isError && !tickets.length ? (
        <div role="status" className="py-8 text-center">
          <p className="text-[14px] text-white/75">
            Couldn&rsquo;t load the guest list. Scanning still works.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 h-11 rounded-xl bg-white/10 px-5 text-[14px] font-semibold text-white active:bg-white/15"
          >
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p role="status" className="py-10 text-center text-[14px] text-white/55">
          {query.trim()
            ? `Nobody matches “${query.trim()}”. Try fewer letters.`
            : filter === "in"
              ? "Nobody checked in yet."
              : filter === "all"
                ? "No guests on the list yet."
                : "Everyone here is checked in."}
        </p>
      ) : (
        <div
          ref={parentRef}
          className="mt-2 overflow-y-auto"
          // `svh`, not `dvh`: Safari's toolbar collapses as you scroll, and a
          // `dvh` height re-measures mid-gesture against absolutely positioned
          // virtual rows. The small viewport does not move.
          style={{ maxHeight: "calc(100svh - 380px)" }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const t = rows[item.index];
              if (!t) return null;
              return (
                <div
                  key={t.id}
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
                  <GuestRow
                    ticket={t}
                    holding={holdings.get(t.id)}
                    busy={checkingInToken === t.qr_token}
                    onCheckIn={onCheckIn}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tickets.length >= ROSTER_CEILING ? (
        <p className="mt-2 text-[12px] text-white/40">
          Showing the first {ROSTER_CEILING}. Use the ticket code to find anyone
          past that.
        </p>
      ) : null}
    </section>
  );
}

function GuestRow({
  ticket,
  holding,
  busy,
  onCheckIn,
}: {
  ticket: TicketRecord;
  /** Which of this person's tickets this row is, when they hold several. */
  holding?: { n: number; of: number };
  busy: boolean;
  onCheckIn: (qrToken: string) => void;
}) {
  const when = minutesSince(ticket.checked_in_at);
  const isIn = !!ticket.checked_in_at;

  return (
    <div className="flex min-h-[56px] items-center gap-3 border-b border-white/8 py-2 pr-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-white">
          {ticket.holder_name ?? "Guest"}
        </p>
        <p className="truncate text-[12px] text-white/50">
          {ticket.ticket_type_name ?? "General"}
          {holding && holding.of > 1 ? ` · ticket ${holding.n} of ${holding.of}` : ""}
          {ticket.status === "refunded" ? " · Refunded" : ""}
        </p>
      </div>

      {!isAdmissible(ticket.status) ? (
        // Refunded, mid-transfer, or a status this build does not know. The
        // row stays so staff can find the person; the action does not, because
        // the only honest answer at the door is "this pass is not valid".
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[#F59E0B]">
          <X size={15} aria-hidden />
          Not valid
        </span>
      ) : isIn ? (
        // State, not an action: word + glyph, so it is never colour alone and
        // the column reads straight down.
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[#22C55E]">
          <Check size={15} aria-hidden />
          In{when ? ` · ${when}` : ""}
        </span>
      ) : (
        <button
          type="button"
          disabled={busy || !ticket.qr_token}
          onClick={() => onCheckIn(ticket.qr_token)}
          className="h-11 shrink-0 rounded-xl border border-white/20 px-4 text-[13px] font-semibold text-white disabled:opacity-40 active:bg-white/10"
        >
          {busy ? "Checking in…" : "Check in"}
        </button>
      )}
    </div>
  );
}

/**
 * Counts for the progress bar, off the same query the list uses. Reading the
 * roster twice under two keys is how a door ends up with a bar that says 40
 * and a list that shows 41.
 */
export function useDoorRosterCounts(eventId: string) {
  const { data } = useQuery({
    queryKey: doorRosterKey(eventId),
    queryFn: () =>
      ticketsApi.getEventTicketsPaginated(eventId, {
        page: 1,
        pageSize: ROSTER_CEILING,
        status: "all",
      }),
    enabled: !!eventId,
    staleTime: 30_000,
  });
  const tickets = (data?.tickets ?? []).filter((t) => t.status !== "void");
  return {
    total: tickets.length,
    checkedIn: tickets.filter((t) => !!t.checked_in_at).length,
  };
}
