"use client";

/**
 * Event Organizer Dashboard — web (port of native
 * `app/(protected)/events/[id]/organizer.tsx`). The host's management hub for a
 * single event: roster stats, scanner/offline/sync actions, sub-tool nav, and a
 * per-ticket refund flow.
 *
 * Law 1 (data is sacred): wires the EXACT native data flow —
 *   • roster via `tickets.getEventTickets(eventId)` (the same backwards-compat
 *     wrapper native calls),
 *   • offline tokens via `ticketsApi.downloadOfflineTokens(eventId)`,
 *   • offline sync via `ticketsApi.syncOfflineScans(pendingScans)`,
 *   • host refund via `organizerApi.refundTicket(ticketId)`,
 *   • offline state via Zustand `useOfflineCheckinStore`,
 *   • toasts via Zustand `useUIStore.showToast`.
 *   No hooks are dropped or substituted.
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) — no
 * <View>/<Text>. The roster list is rendered with TanStack Virtual (never
 * FlatList/FlashList). Avatars are rounded squares, never pills (status chips
 * are the only rounded-full elements). Local UI flags live in a tiny Zustand
 * store (never useState). Event id via solito `useParams`; nav rows push the
 * same sub-routes native pushes (scanner / analytics / promo-codes /
 * attendees / staff / edit). Header sticky, content max-w-2xl, bg #06070d,
 * accent cyan #3FDCFF.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { useParams, useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle,
  Clock,
  CloudUpload,
  QrCode,
  Settings,
  Tag,
  Undo2,
  User,
  Users,
  WifiOff,
  XCircle,
} from "lucide-react";
import { tickets, ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { organizerApi } from "@dvnt/app/lib/api/organizer";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useOfflineCheckinStore } from "@dvnt/app/lib/stores/offline-checkin-store";

// ── Local UI state (Zustand, never useState) ──
interface OrganizerUIState {
  roster: TicketRecord[];
  isLoading: boolean;
  isRefreshing: boolean;
  isDownloading: boolean;
  isSyncing: boolean;
  refundingTicketId: string | null;
  setRoster: (roster: TicketRecord[]) => void;
  setLoading: (v: boolean) => void;
  setRefreshing: (v: boolean) => void;
  setDownloading: (v: boolean) => void;
  setSyncing: (v: boolean) => void;
  setRefundingTicketId: (id: string | null) => void;
  reset: () => void;
}

const useOrganizerUIStore = create<OrganizerUIState>((set) => ({
  roster: [],
  isLoading: true,
  isRefreshing: false,
  isDownloading: false,
  isSyncing: false,
  refundingTicketId: null,
  setRoster: (roster) => set({ roster }),
  setLoading: (isLoading) => set({ isLoading }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setDownloading: (isDownloading) => set({ isDownloading }),
  setSyncing: (isSyncing) => set({ isSyncing }),
  setRefundingTicketId: (refundingTicketId) => set({ refundingTicketId }),
  reset: () =>
    set({
      roster: [],
      isLoading: true,
      isRefreshing: false,
      isDownloading: false,
      isSyncing: false,
      refundingTicketId: null,
    }),
}));

const ROW_HEIGHT = 96; // 84px card + 12px gap

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function displayName(ticket: TicketRecord): string {
  return ticket.username || "Guest";
}

// Native roster statuses: "checked_in" / "revoked" / "valid". The web
// TicketRecord exposes Stripe-aligned statuses; map them the same way native's
// stat math does — `scanned` == checked in, `refunded`/`void` == revoked,
// everything else (active / transfer_pending) == valid.
function isCheckedIn(t: TicketRecord): boolean {
  return t.status === "scanned" || !!t.checked_in_at;
}
function isRevoked(t: TicketRecord): boolean {
  return t.status === "refunded" || t.status === "void";
}

function StatCard({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <span className="text-2xl font-bold" style={{ color }}>
        {value}
      </span>
      <span className="mt-1 text-xs text-white/60">{label}</span>
    </div>
  );
}

function StatusChip({ ticket }: { ticket: TicketRecord }) {
  if (isCheckedIn(ticket)) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1.5 text-xs font-semibold text-green-400">
        <CheckCircle size={14} color="#22c55e" />
        Checked In
      </span>
    );
  }
  if (isRevoked(ticket)) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-400">
        <XCircle size={14} color="#ef4444" />
        Revoked
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/60">
      <Clock size={14} color="rgba(255,255,255,0.6)" />
      Valid
    </span>
  );
}

function TicketRow({
  ticket,
  isRefunding,
  onRefund,
}: {
  ticket: TicketRecord;
  isRefunding: boolean;
  onRefund: () => void;
}) {
  const refundable = !isRevoked(ticket) && !isCheckedIn(ticket);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Rounded-square avatar (never a circle/pill) */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8">
            <User size={20} color="#fff" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-white">
              {displayName(ticket)}
            </p>
            <p className="truncate font-mono text-xs text-white/50">
              {ticket.id}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <StatusChip ticket={ticket} />
        </div>
      </div>

      {ticket.checked_in_at ? (
        <p className="mt-2 text-xs text-white/60">
          Checked in: {formatDate(ticket.checked_in_at)}
        </p>
      ) : null}

      {refundable ? (
        <button
          type="button"
          onClick={onRefund}
          disabled={isRefunding}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 py-2 text-xs font-bold text-red-500 active:opacity-80 disabled:opacity-50"
        >
          {isRefunding ? (
            <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-red-500/30 border-t-red-500 animate-spin" />
          ) : (
            <>
              <Undo2 size={13} color="#ef4444" />
              Refund ticket
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

export function EventOrganizerScreen() {
  const router = useRouter();
  const params = useParams();
  const rawId = (params as Record<string, string | string[]>)?.id;
  const eventId = Array.isArray(rawId) ? rawId[0] ?? "" : rawId ?? "";

  const showToast = useUIStore((s) => s.showToast);

  // Offline check-in state (Zustand — exact native store)
  const offlineStore = useOfflineCheckinStore();
  const hasOfflineData = offlineStore.hasOfflineData(eventId);
  const lastDownloaded = offlineStore.lastDownloaded[eventId];
  const pendingScans = useMemo(
    () => offlineStore.pendingScans.filter((s) => s.eventId === eventId),
    [offlineStore.pendingScans, eventId],
  );

  // Local UI flags (Zustand)
  const roster = useOrganizerUIStore((s) => s.roster);
  const isLoading = useOrganizerUIStore((s) => s.isLoading);
  const isRefreshing = useOrganizerUIStore((s) => s.isRefreshing);
  const isDownloading = useOrganizerUIStore((s) => s.isDownloading);
  const isSyncing = useOrganizerUIStore((s) => s.isSyncing);
  const refundingTicketId = useOrganizerUIStore((s) => s.refundingTicketId);
  const setRoster = useOrganizerUIStore((s) => s.setRoster);
  const setLoading = useOrganizerUIStore((s) => s.setLoading);
  const setRefreshing = useOrganizerUIStore((s) => s.setRefreshing);
  const setDownloading = useOrganizerUIStore((s) => s.setDownloading);
  const setSyncing = useOrganizerUIStore((s) => s.setSyncing);
  const setRefundingTicketId = useOrganizerUIStore((s) => s.setRefundingTicketId);

  const loadTickets = useCallback(async () => {
    try {
      const result = await tickets.getEventTickets(eventId);
      setRoster(result || []);
    } catch (error: any) {
      console.error("[Organizer] Load tickets error:", error);
      showToast("error", "Error", error?.error || "Failed to load tickets");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, setRoster, setLoading, setRefreshing, showToast]);

  useEffect(() => {
    if (eventId) loadTickets();
  }, [eventId, loadTickets]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTickets();
  }, [loadTickets, setRefreshing]);

  const handleDownloadForOffline = useCallback(async () => {
    setDownloading(true);
    try {
      const tokens = await ticketsApi.downloadOfflineTokens(eventId);
      if (tokens.length > 0) {
        offlineStore.setTokensForEvent(eventId, tokens);
        showToast(
          "success",
          "Downloaded",
          `${tokens.length} tickets ready for offline scanning`,
        );
      } else {
        showToast("info", "No Tickets", "No active tickets to download");
      }
    } catch (err) {
      console.error("[Organizer] Download offline tokens error:", err);
      showToast("error", "Error", "Failed to download tickets for offline use");
    } finally {
      setDownloading(false);
    }
  }, [eventId, offlineStore, showToast, setDownloading]);

  const handleSyncPendingScans = useCallback(async () => {
    if (pendingScans.length === 0) return;
    setSyncing(true);
    try {
      const result = await ticketsApi.syncOfflineScans(pendingScans);
      if (result.synced.length > 0) {
        offlineStore.removePendingScans(eventId, result.synced);
        showToast(
          "success",
          "Synced",
          `${result.synced.length} offline scan(s) synced`,
        );
        loadTickets();
      }
      if (result.failed.length > 0) {
        showToast(
          "error",
          "Sync Partial",
          `${result.failed.length} scan(s) failed to sync`,
        );
      }
    } catch (err) {
      console.error("[Organizer] Sync error:", err);
      showToast("error", "Error", "Failed to sync offline scans");
    } finally {
      setSyncing(false);
    }
  }, [pendingScans, eventId, offlineStore, showToast, loadTickets, setSyncing]);

  const handleRefundTicket = useCallback(
    async (ticketId: string, buyerName: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Refund this ticket?\n\nThis cancels the ticket for ${buyerName} and refunds the full purchase back to their card. Cannot be undone.`,
        )
      ) {
        return;
      }
      setRefundingTicketId(ticketId);
      try {
        const res = await organizerApi.refundTicket(ticketId);
        if (res.error) {
          showToast("error", "Refund failed", res.error);
          return;
        }
        showToast(
          "success",
          res.free ? "Ticket voided" : "Refund started",
          res.free
            ? "The ticket is marked refunded — no payment to reverse."
            : "Stripe is processing the refund. The ticket status updates shortly.",
        );
        await loadTickets();
      } catch (err: any) {
        showToast(
          "error",
          "Refund failed",
          err?.message || "Try again in a moment.",
        );
      } finally {
        setRefundingTicketId(null);
      }
    },
    [showToast, loadTickets, setRefundingTicketId],
  );

  const checkedInCount = useMemo(
    () => roster.filter(isCheckedIn).length,
    [roster],
  );
  const totalCount = roster.length;
  const remainingCount = totalCount - checkedInCount;

  // ── Virtualized roster (TanStack Virtual, never FlatList/FlashList) ──
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: roster.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

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
        <h1 className="flex-1 text-[17px] font-semibold">Event Tickets</h1>
        <button
          onClick={() => router.push(`/feed/events/${eventId}/edit`)}
          aria-label="Event settings"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <Settings size={18} color="rgba(255,255,255,0.6)" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4">
        {/* Stats bar */}
        <div className="flex items-center gap-3 border-b border-white/8 py-4">
          <StatCard value={totalCount} label="Total Tickets" color="#fff" />
          <span className="h-10 w-px bg-white/10" />
          <StatCard value={checkedInCount} label="Checked In" color="#22c55e" />
          <span className="h-10 w-px bg-white/10" />
          <StatCard value={remainingCount} label="Remaining" color="#3FDCFF" />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 py-4">
          {/* Primary: open the full-screen scanner route */}
          <button
            type="button"
            onClick={() => router.push(`/feed/events/${eventId}/scanner`)}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#3FDCFF] py-3.5 active:opacity-80"
          >
            <QrCode size={20} color="#000" />
            <span className="text-base font-semibold text-black">
              Scan QR Code
            </span>
          </button>

          {/* Download offline / Sync row */}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={handleDownloadForOffline}
              disabled={isDownloading}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-3 text-[13px] font-semibold disabled:opacity-60"
              style={{
                backgroundColor: hasOfflineData
                  ? "rgba(34,197,94,0.1)"
                  : "rgba(255,255,255,0.06)",
                borderColor: hasOfflineData
                  ? "rgba(34,197,94,0.3)"
                  : "rgba(255,255,255,0.1)",
                color: hasOfflineData ? "#22c55e" : "#fff",
              }}
            >
              {isDownloading ? (
                <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <WifiOff
                  size={16}
                  color={hasOfflineData ? "#22c55e" : "rgba(255,255,255,0.6)"}
                />
              )}
              {hasOfflineData ? "Offline Ready" : "Download Offline"}
            </button>

            {pendingScans.length > 0 ? (
              <button
                type="button"
                onClick={handleSyncPendingScans}
                disabled={isSyncing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-500/30 bg-orange-500/10 py-3 text-[13px] font-semibold text-orange-500 disabled:opacity-60"
              >
                {isSyncing ? (
                  <span className="inline-block h-4 w-4 rounded-full border-2 border-orange-500/30 border-t-orange-500 animate-spin" />
                ) : (
                  <CloudUpload size={16} color="#f97316" />
                )}
                Sync {pendingScans.length} Scan
                {pendingScans.length !== 1 ? "s" : ""}
              </button>
            ) : null}
          </div>

          {hasOfflineData && lastDownloaded ? (
            <p className="text-center text-[11px] text-white/60">
              Last downloaded: {formatDate(lastDownloaded)}
            </p>
          ) : null}

          {/* Sub-tool nav: Analytics + Promo Codes */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${eventId}/analytics`)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 py-3 text-[13px] font-semibold text-white active:bg-white/8"
            >
              <BarChart3 size={16} color="#22c55e" />
              Analytics
            </button>
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${eventId}/promo-codes`)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 py-3 text-[13px] font-semibold text-white active:bg-white/8"
            >
              <Tag size={16} color="#8A40CF" />
              Promo Codes
            </button>
          </div>

          {/* Sub-tool nav: Attendees + Staff (native sibling routes) */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${eventId}/attendees`)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 py-3 text-[13px] font-semibold text-white active:bg-white/8"
            >
              <Users size={16} color="#3FDCFF" />
              Attendees
            </button>
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${eventId}/staff`)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/6 py-3 text-[13px] font-semibold text-white active:bg-white/8"
            >
              <User size={16} color="#EAB308" />
              Staff
            </button>
          </div>
        </div>

        {/* Roster */}
        {isLoading ? (
          <div className="flex flex-col gap-3 pb-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[84px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : roster.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-base text-white/60">No tickets yet</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                Attendees
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="text-xs font-semibold text-cyan-400 active:opacity-70 disabled:opacity-50"
              >
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div
              ref={parentRef}
              className="overflow-y-auto pb-12"
              style={{ maxHeight: "calc(100dvh - 360px)" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const ticket = roster[item.index];
                  if (!ticket) return null;
                  return (
                    <div
                      key={ticket.id}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: 12,
                      }}
                    >
                      <TicketRow
                        ticket={ticket}
                        isRefunding={refundingTicketId === ticket.id}
                        onRefund={() =>
                          handleRefundTicket(ticket.id, displayName(ticket))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default EventOrganizerScreen;
