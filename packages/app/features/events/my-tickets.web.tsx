"use client";

/**
 * My Tickets — web (port of native `app/(protected)/events/my-tickets.tsx`).
 *
 * Law 1 (data wiring is sacred): the list comes from the EXACT native hook
 * `useMyTickets()`, pending transfers from `ticketsApi.getPendingTransfers()`,
 * accept/decline via `ticketsApi.acceptTransfer/declineTransfer`, and ticket tap
 * primes the detail cache with `queryClient.setQueryData(ticketKeys.myTicketForEvent(...))`
 * exactly like native before navigating.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No View/Text.
 * Lists = TanStack Virtual (never FlatList/FlashList). Avatars/thumbs are rounded
 * squares, never pills. Active upcoming/past tab lives in a tiny Zustand store.
 *
 * Native renders a QR via react-native-qrcode-svg (native-only). On web there is
 * no QR lib present, so the ticket card surfaces the ticket code; the full QR
 * lives on the ticket detail route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  QrCode,
  Send,
  Shirt,
  Ticket,
} from "lucide-react";
import { ticketKeys, useMyTickets } from "@dvnt/app/lib/hooks/use-tickets";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import {
  useMyTicketsTabStore,
  type TicketsTab,
} from "./my-tickets-tab-store";

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function resolveImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  return `${CDN_URL}/${src}`;
}

const STATUS_COLORS: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  active: { bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E", label: "Active" },
  scanned: { bg: "rgba(59, 130, 246, 0.15)", text: "#3B82F6", label: "Used" },
  refunded: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", label: "Refunded" },
  void: { bg: "rgba(107, 114, 128, 0.15)", text: "#6B7280", label: "Void" },
  transfer_pending: {
    bg: "rgba(138, 64, 207, 0.15)",
    text: "#8A40CF",
    label: "Transfer Pending",
  },
  payment_pending: {
    bg: "rgba(234, 179, 8, 0.15)",
    text: "#EAB308",
    label: "Payment Pending",
  },
};

const ROW_HEIGHT = 122; // 110px card + 12px gap

type Row =
  | { kind: "transfer"; key: string; transfer: any }
  | { kind: "ticket"; key: string; ticket: TicketRecord };

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isUpcoming(ticket: TicketRecord): boolean {
  if (!ticket.event_date) return true; // undated tickets default to upcoming
  const d = new Date(ticket.event_date).getTime();
  if (Number.isNaN(d)) return true;
  // Same-day or future events count as upcoming.
  return d >= Date.now() - 24 * 60 * 60 * 1000;
}

function TicketCard({
  ticket,
  onPress,
}: {
  ticket: TicketRecord;
  onPress: () => void;
}) {
  const status = STATUS_COLORS[ticket.status] || STATUS_COLORS.void;
  const isCoatCheck = ticket.category === "coat_check";
  const imageUrl = resolveImageUrl(ticket.event_image);

  return (
    <div
      onClick={onPress}
      role="button"
      tabIndex={0}
      className={`flex overflow-hidden rounded-2xl border cursor-pointer transition-colors ${
        isCoatCheck
          ? "border-purple-500/20 bg-slate-950 active:bg-slate-900"
          : "border-white/10 bg-white/4 active:bg-white/6"
      }`}
      style={{ height: 110 }}
    >
      {/* Event thumb (rounded square crop, never a pill) */}
      {imageUrl && !isCoatCheck ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={ticket.event_title || "Event"}
          className="h-full w-20 shrink-0 object-cover bg-white/10"
        />
      ) : (
        <div className="flex h-full w-20 shrink-0 items-center justify-center bg-white/8">
          {isCoatCheck ? (
            <Shirt size={22} color="#A78BFA" />
          ) : (
            <Ticket size={24} color="#666" />
          )}
        </div>
      )}

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">
            {ticket.event_title || "Event"}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/60">
            {isCoatCheck
              ? `Coat Check · ${ticket.ticket_type_name || "Pass"}`
              : ticket.ticket_type_name}
          </p>
        </div>

        <div className="mt-2 flex items-center gap-3">
          {ticket.event_date ? (
            <span className="flex items-center gap-1 text-[10px] text-white/60">
              <Calendar size={10} color="#999" />
              {formatEventDate(ticket.event_date)}
            </span>
          ) : null}
          {ticket.event_location ? (
            <span className="flex min-w-0 items-center gap-1 text-[10px] text-white/60">
              <MapPin size={10} color="#999" />
              <span className="truncate">{ticket.event_location}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Status + QR/code */}
      <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-2 px-3">
        <span
          style={{ backgroundColor: status.bg, color: status.text }}
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
        >
          {status.label}
        </span>
        {ticket.status === "active" ? (
          isCoatCheck ? (
            <Shirt size={18} color="#A78BFA" />
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <QrCode size={20} color="#8A40CF" />
              {ticket.qr_token ? (
                <span className="font-mono text-[9px] tracking-wide text-white/40">
                  {ticket.qr_token.slice(0, 8).toUpperCase()}
                </span>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

function PendingTransferCard({
  transfer,
  onAction,
}: {
  transfer: any;
  onAction: () => void;
}) {
  const [isActing, setIsActing] = useState(false);
  const eventTitle = transfer.tickets?.events?.title || "Event";
  const tierName = transfer.tickets?.ticket_types?.name || "Ticket";

  const handleAccept = async () => {
    setIsActing(true);
    const result = await ticketsApi.acceptTransfer(transfer.id);
    if (!result.error) onAction();
    setIsActing(false);
  };

  const handleDecline = async () => {
    if (!window.confirm("Decline this transfer?")) return;
    setIsActing(true);
    const result = await ticketsApi.declineTransfer(transfer.id);
    if (!result.error) onAction();
    setIsActing(false);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/4 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Send size={14} color="#8A40CF" />
        <span className="text-xs font-semibold text-purple-400">
          Incoming Transfer
        </span>
      </div>
      <p className="truncate text-sm font-bold text-white">{eventTitle}</p>
      <p className="mt-0.5 text-xs text-white/60">{tierName}</p>
      {transfer.expires_at ? (
        <p className="mt-1 text-[10px] text-white/50">
          Expires{" "}
          {new Date(transfer.expires_at).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={isActing}
          className="flex-1 rounded-lg bg-cyan-500 py-2 text-xs font-semibold text-black disabled:opacity-50"
        >
          {isActing ? "..." : "Accept"}
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={isActing}
          className="flex-1 rounded-lg border border-white/10 py-2 text-xs font-semibold text-white/70 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

const TABS: { key: TicketsTab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

export function MyTicketsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: tickets, isLoading, isError, refetch } = useMyTickets();

  const activeTab = useMyTicketsTabStore((s) => s.activeTab);
  const setActiveTab = useMyTicketsTabStore((s) => s.setActiveTab);

  const [pendingTransfers, setPendingTransfers] = useState<any[]>([]);

  const loadTransfers = useCallback(async () => {
    try {
      const { incoming } = await ticketsApi.getPendingTransfers();
      setPendingTransfers(incoming ?? []);
    } catch (e) {
      console.warn("[MyTickets] loadTransfers failed:", e);
    }
  }, []);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const handleTransferAction = useCallback(() => {
    loadTransfers();
    refetch();
  }, [loadTransfers, refetch]);

  const handleTicketPress = useCallback(
    (ticket: TicketRecord) => {
      const eventId = String(ticket.event_id || "");
      if (!eventId) return;
      // Prime the detail cache exactly like native before navigating.
      queryClient.setQueryData(ticketKeys.myTicketForEvent(eventId), ticket);
      router.push(`/feed/ticket/${eventId}`);
    },
    [queryClient, router],
  );

  const { upcoming, past } = useMemo(() => {
    const all = tickets || [];
    return {
      upcoming: all.filter(isUpcoming),
      past: all.filter((t) => !isUpcoming(t)),
    };
  }, [tickets]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (activeTab === "upcoming") {
      for (const t of pendingTransfers) {
        list.push({ kind: "transfer", key: `transfer-${t.id}`, transfer: t });
      }
      for (const t of upcoming) {
        list.push({ kind: "ticket", key: t.id, ticket: t });
      }
    } else {
      for (const t of past) {
        list.push({ kind: "ticket", key: t.id, ticket: t });
      }
    }
    return list;
  }, [activeTab, pendingTransfers, upcoming, past]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showEmpty =
    !isLoading && !isError && rows.length === 0;

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
        <h1 className="flex-1 text-[17px] font-semibold">My Tickets</h1>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Tabs */}
        <div className="mb-4 flex gap-2 rounded-xl border border-white/8 bg-white/4 p-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-cyan-500 text-black"
                    : "text-white/60 active:bg-white/6"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[110px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <Ticket size={48} color="rgba(255,255,255,0.15)" />
            <p className="mt-3 text-white/60">
              Failed to load tickets. Refresh to retry.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 rounded-full bg-cyan-500 px-6 py-2 text-sm font-semibold text-black"
            >
              Retry
            </button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <Ticket size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">
              {activeTab === "past" ? "No past tickets" : "No tickets yet"}
            </p>
            <p className="mt-1 text-sm text-white/60">
              {activeTab === "past"
                ? "Tickets for events that have ended will appear here"
                : "Your purchased tickets will appear here"}
            </p>
            {activeTab === "upcoming" ? (
              <button
                type="button"
                onClick={() => router.push("/feed/events")}
                className="mt-6 rounded-full bg-cyan-500 px-6 py-3 font-semibold text-black"
              >
                Browse Events
              </button>
            ) : null}
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 200px)" }}
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
                      paddingBottom: 12,
                    }}
                  >
                    {row.kind === "transfer" ? (
                      <PendingTransferCard
                        transfer={row.transfer}
                        onAction={handleTransferAction}
                      />
                    ) : (
                      <TicketCard
                        ticket={row.ticket}
                        onPress={() => handleTicketPress(row.ticket)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default MyTicketsScreen;
