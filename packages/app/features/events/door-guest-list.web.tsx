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
 * Fetch every server-authorized keyset page before publishing a complete roster.
 * Local search preserves role-redacted guest/name/email lookup offline; it no
 * longer silently drops attendees after the first 200 tickets.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import { Search, Check, X } from "lucide-react";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { qk } from "@dvnt/app/lib/query/keys";
import { hasAdmissionPurpose, ticketCategoryLabel } from "@dvnt/app/lib/tickets/ticket-category";
import { isAdmissible, isListable } from "@dvnt/app/lib/tickets/ticket-access";
import { REFUND_DOOR_NOTE, REFUND_REASON } from "@dvnt/app/lib/tickets/refund-notice";
import {
  snapshotRoster,
  recallRoster,
  type CachedGuest,
} from "./door-roster-cache.web";

const rosterAccount = (user: { id: string | number; authId?: string | null } | null) =>
  user ? `${user.id}:${user.authId || ""}` : "";

function useCompleteDoorRoster(eventId: string) {
  const accountKey = useAuthStore((s) => rosterAccount(s.user));
  const result = useQuery({
    queryKey: [...doorRosterKey(eventId), "complete-door", accountKey],
    queryFn: async ({ signal }) => ({ tickets: await ticketsApi.getEventTickets(eventId,
      () => !signal.aborted && !!accountKey && rosterAccount(useAuthStore.getState().user) === accountKey) }),
    enabled: !!eventId && !!accountKey,
    staleTime: 30_000,
    networkMode: "always",
  });
  return { ...result, accountKey };
}

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

type Filter = "all" | "in" | "out" | "refunded";

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

  const { data, isLoading, isError, refetch, accountKey, error } = useCompleteDoorRoster(eventId);

  /**
   * Live roster when there is one, the device's last snapshot when there is
   * not. A door with no signal and a reloaded phone otherwise has an empty
   * list and no way to look anyone up.
   */
  const denied = [401, 403].includes(Number((error as { status?: number } | null)?.status));
  const cached = useMemo(() => (isError && !denied && typeof navigator !== "undefined" && navigator.onLine === false
    ? recallRoster(eventId, accountKey) : null), [isError, denied, eventId, accountKey]);

  const tickets = useMemo(() => {
    const live = (data?.tickets ?? []).filter((t) => isListable(t.status));
    if (!isError && data) return live;
    // CachedGuest carries only the fields this list renders; the cast keeps
    // the row component honest about what it may read.
    return (cached?.guests ?? []).filter(
      (g) => isListable(g.status),
    ) as unknown as TicketRecord[];
  }, [data, cached, isError]);

  // Snapshot every successful read, so the fallback is never older than the
  // last time this phone had signal.
  useEffect(() => {
    const live = (data?.tickets ?? []).filter((t) => isListable(t.status));
    if (data && !isError && accountKey) snapshotRoster(eventId, live, accountKey);
  }, [data, eventId, accountKey, isError]);

  // Admission progress excludes services/products; All still lists those
  // credentials for lookup/redemption. A refunded ticket is still listed
  // — staff need to find that person when they turn up insisting they have a
  // ticket — but it is not a guest who is coming, so it must not inflate the
  // denominator that tells the door how far through the queue they are.
  const counts = useMemo(() => {
    const admissible = tickets.filter((t) => isAdmissible(t.status) && hasAdmissionPurpose(t.category));
    const checkedIn = admissible.filter((t) => t.status === "scanned" || !!t.checked_in_at).length;
    return {
      all: tickets.filter((t) => isAdmissible(t.status)).length,
      in: checkedIn,
      out: admissible.length - checkedIn,
      refunded: tickets.filter((t) => !isAdmissible(t.status)).length,
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
      // Refunded passes live in their own tab. They used to sit in All, where
      // a door counting heads had no way to tell them from guests who were
      // actually coming.
      const admissible = isAdmissible(t.status);
      if (filter === "refunded" ? admissible : !admissible) return false;
      if ((filter === "in" || filter === "out") && !hasAdmissionPurpose(t.category)) return false;
      if (filter === "in" && t.status !== "scanned" && !t.checked_in_at) return false;
      if (filter === "out" && (t.status === "scanned" || t.checked_in_at)) return false;
      if (!q) return true;
      // Match every name the row can carry, not just the resolved one. An
      // owner/admin roster returns the full ticket, so a guest who bought
      // under one name and is listed under another is findable either way —
      // staff get told a name at the door, not a field label. Scanner rosters
      // are PII-redacted and simply have fewer of these, which costs nothing.
      const t2 = t as typeof t & {
        attendee_name?: string | null;
        guest_name?: string | null;
        guest_email?: string | null;
      };
      const haystacks = [
        t.holder_name,
        t2.attendee_name,
        t2.guest_name,
        t2.guest_email,
      ];
      if (haystacks.some((h) => (h ?? "").toLowerCase().includes(q))) return true;
      return (t.qr_token ?? "").toLowerCase().startsWith(q);
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
        <span className="sr-only">Search guests to check someone in by hand</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name, email, or ticket code"
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
        {/* Only when there are any. An empty Refunded tab is a question staff
            do not need to answer at a door. */}
        {counts.refunded > 0 ? chip("refunded", "Refunded", counts.refunded) : null}
      </div>

      {filter === "refunded" ? (
        <p className="mt-2 rounded-lg bg-white/[0.06] px-3 py-2 text-[12px] leading-relaxed text-white/70">
          {REFUND_DOOR_NOTE}
          <br />
          <span className="text-white/50">{REFUND_REASON}</span>
        </p>
      ) : null}

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
                : filter === "refunded"
                  ? "No refunded passes on this event."
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
  const isIn = ticket.status === "scanned" || !!ticket.checked_in_at;

  return (
    <div className="flex min-h-[56px] items-center gap-3 border-b border-white/8 py-2 pr-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-white">
          {ticket.holder_name ?? "Guest"}
        </p>
        <p className="truncate text-[12px] text-white/50">
          {ticket.ticket_type_name ?? ticketCategoryLabel(ticket.category)}
          {!hasAdmissionPurpose(ticket.category) ? ` · ${ticket.category ? ticketCategoryLabel(ticket.category) : "Purpose not verified"}` : ""}
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
      ) : !hasAdmissionPurpose(ticket.category) ? (
        <span className="shrink-0 text-[12px] font-semibold text-white/65">
          {isIn ? "Redeemed · no entry" : "Not admission"}
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
  const { data, isError } = useCompleteDoorRoster(eventId);
  const tickets = (isError ? [] : data?.tickets ?? []).filter((t) => isAdmissible(t.status) && hasAdmissionPurpose(t.category));
  return {
    total: tickets.length,
    checkedIn: tickets.filter((t) => t.status === "scanned" || !!t.checked_in_at).length,
  };
}
