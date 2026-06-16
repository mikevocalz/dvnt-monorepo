"use client";

/**
 * Ticket Detail — web (port of native `app/(protected)/ticket/[id].tsx`).
 *
 * Law 1 (data wiring is sacred): the ticket comes from the EXACT native hook
 * `useMyTicketForEvent(eventId)` (with `useTicketStore` fallback for freshly
 * RSVPed tickets), upgrade tiers from `ticketTypesApi.getByEvent`, the pending
 * outgoing transfer from `ticketsApi.getPendingTransfers()`, and every action
 * routes through the same `ticketsApi` mutations native uses —
 * `initiateTransfer` (send), `acceptTransfer`/`declineTransfer` (handled on
 * my-tickets), `cancelTransfer` (cancel), `requestRefund`/`requestLineRefund`.
 * Upgrade navigates to `/feed/ticket/upgrade/{id}`.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No View/Text.
 * Avatars/thumbs are rounded squares; status uses pills like native.
 *
 * QR on web: native renders react-native-qrcode-svg (native only). Here we
 * generate a data url with the installed `qrcode` package and render <img>.
 *
 * Transient UI (transfer dialog, QR data url, per-action states) lives in a tiny
 * Zustand store (`ticket-detail-ui-store`) — never useState.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useParams } from "solito/navigation";
import { useRouter } from "solito/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — `qrcode` ships without bundled types in this monorepo.
import QRCode from "qrcode";
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  Gem,
  Hash,
  Lock,
  MapPin,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  Shirt,
  Sparkles,
  Star,
  Ticket as TicketIcon,
  TicketX,
  XCircle,
} from "lucide-react";
import { Dialog } from "@dvnt/ui";
import {
  ticketKeys,
  useMyTicketForEvent,
} from "@dvnt/app/lib/hooks/use-tickets";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { ticketTypesApi } from "@dvnt/app/lib/api/ticket-types";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import type {
  Ticket,
  TicketTierLevel,
} from "@dvnt/app/lib/stores/ticket-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { useEventRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import { useTicketDetailUIStore } from "@dvnt/app/lib/stores/ticket-detail-ui-store";

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function resolveImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  return `${CDN_URL}/${src}`;
}

const TIER_ACCENT: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

const TIER_CONFIG: Record<
  TicketTierLevel,
  { label: string; badgeBg: string; Icon: typeof Crown }
> = {
  free: { label: "FREE", badgeBg: "rgba(63,220,255,0.15)", Icon: TicketIcon },
  ga: { label: "GENERAL", badgeBg: "rgba(52,162,223,0.15)", Icon: Star },
  vip: { label: "VIP", badgeBg: "rgba(138,64,207,0.18)", Icon: Crown },
  table: { label: "TABLE", badgeBg: "rgba(255,91,252,0.18)", Icon: Gem },
};

/** Map a DB TicketRecord → the Ticket shape used by UI (verbatim from native). */
function dbToTicket(rec: TicketRecord): Ticket {
  const normalizedTierName = (rec.ticket_type_name || "").toLowerCase();
  return {
    id: rec.id,
    eventId: String(rec.event_id),
    userId: rec.user_id,
    paid: (rec.purchase_amount_cents ?? 0) > 0,
    status:
      rec.status === "active"
        ? "valid"
        : rec.status === "scanned"
          ? "checked_in"
          : rec.status === "refunded" || rec.status === "void"
            ? "revoked"
            : rec.status === "transfer_pending"
              ? "transfer_pending"
              : "expired",
    checkedInAt: rec.checked_in_at ?? undefined,
    qrToken: rec.qr_token,
    tier: (normalizedTierName.includes("vip")
      ? "vip"
      : normalizedTierName.includes("table")
        ? "table"
        : (rec.purchase_amount_cents ?? 0) === 0
          ? "free"
          : "ga") as TicketTierLevel,
    tierName: rec.ticket_type_name || "General Admission",
    eventTitle: rec.event_title || "",
    eventDate: rec.event_date || "",
    eventLocation: rec.event_location || "",
    eventImage: rec.event_image || "",
    transferable: true,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TicketDetailScreen() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const rawId = params?.id;
  const eventId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");

  // Phase 2 — the wallet ticket reflects live event changes (time/venue/cancel)
  // the holder is staring at, no manual refresh.
  useEventRealtime(eventId);

  // ── Ticket data — EXACT native hook + Zustand fallback ──
  const { data: dbTicket, isLoading } = useMyTicketForEvent(eventId);
  const storeTicket = useTicketStore((s) => s.getTicketByEventId(eventId));
  const ticket: Ticket | undefined = dbTicket
    ? dbToTicket(dbTicket)
    : storeTicket;

  // ── Transient UI (Zustand, never useState) ──
  const qrDataUrl = useTicketDetailUIStore((s) => s.qrDataUrl);
  const setQrDataUrl = useTicketDetailUIStore((s) => s.setQrDataUrl);
  const showTransferModal = useTicketDetailUIStore((s) => s.showTransferModal);
  const setShowTransferModal = useTicketDetailUIStore(
    (s) => s.setShowTransferModal,
  );
  const transferQuery = useTicketDetailUIStore((s) => s.transferQuery);
  const setTransferQuery = useTicketDetailUIStore((s) => s.setTransferQuery);
  const transferState = useTicketDetailUIStore((s) => s.transferState);
  const setTransferState = useTicketDetailUIStore((s) => s.setTransferState);
  const shareState = useTicketDetailUIStore((s) => s.shareState);
  const setShareState = useTicketDetailUIStore((s) => s.setShareState);
  const cancelingTransfer = useTicketDetailUIStore((s) => s.cancelingTransfer);
  const setCancelingTransfer = useTicketDetailUIStore(
    (s) => s.setCancelingTransfer,
  );
  const refundStep = useTicketDetailUIStore((s) => s.refundStep);
  const setRefundStep = useTicketDetailUIStore((s) => s.setRefundStep);
  const resetUI = useTicketDetailUIStore((s) => s.reset);

  // Reset transient UI when the event changes / on unmount.
  useEffect(() => {
    resetUI();
    return () => resetUI();
  }, [eventId, resetUI]);

  // ── Generate QR data url from the token (async → Zustand field) ──
  const qrToken = ticket?.qrToken || "";
  useEffect(() => {
    let cancelled = false;
    if (!qrToken) {
      setQrDataUrl(null);
      return;
    }
    (
      QRCode as unknown as {
        toDataURL: (
          text: string,
          opts?: { width?: number; margin?: number },
        ) => Promise<string>;
      }
    )
      .toDataURL(qrToken, { width: 320, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken, setQrDataUrl]);

  // ── Upgrade tiers (existence drives the upgrade card) ──
  const { data: upgradeTiers = [] } = useQuery({
    queryKey: [
      "ticket-upgrade-tiers",
      dbTicket?.event_id ?? "",
      dbTicket?.purchase_amount_cents ?? 0,
    ],
    enabled: !!dbTicket?.event_id && dbTicket?.status === "active",
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!dbTicket?.event_id) return [] as any[];
      const tiers = await ticketTypesApi.getByEvent(String(dbTicket.event_id));
      const paidCents = dbTicket.purchase_amount_cents ?? 0;
      return tiers.filter(
        (t: any) =>
          t.is_active !== false &&
          (t.price_cents ?? 0) > paidCents &&
          t.id !== dbTicket.ticket_type_id,
      );
    },
  });

  // ── Pending outgoing transfer (for Cancel CTA) ──
  const { data: pendingTransfers } = useQuery({
    queryKey: ["ticket-transfers", "outgoing", dbTicket?.id ?? ""],
    queryFn: () => ticketsApi.getPendingTransfers(),
    enabled: !!dbTicket?.id && dbTicket?.status === "transfer_pending",
    staleTime: 10 * 1000,
  });
  const outgoingTransfer = useMemo(() => {
    if (!pendingTransfers?.outgoing || !dbTicket?.id) return null;
    return (
      pendingTransfers.outgoing.find(
        (t: any) => String(t.ticket_id) === String(dbTicket.id),
      ) ?? null
    );
  }, [pendingTransfers, dbTicket?.id]);

  const handleCancelTransfer = useCallback(async () => {
    if (!outgoingTransfer?.id || cancelingTransfer) return;
    setCancelingTransfer(true);
    try {
      const res = await ticketsApi.cancelTransfer(String(outgoingTransfer.id));
      if (res.error) {
        showToast("error", "Couldn't cancel", res.error);
        return;
      }
      showToast("success", "Transfer canceled", "Your ticket is back to you.");
      await queryClient.invalidateQueries({
        queryKey: ticketKeys.myTicketForEvent(eventId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["ticket-transfers", "outgoing"],
      });
    } catch (err: any) {
      showToast(
        "error",
        "Couldn't cancel",
        err?.message || "Try again in a moment.",
      );
    } finally {
      setCancelingTransfer(false);
    }
  }, [
    outgoingTransfer?.id,
    cancelingTransfer,
    setCancelingTransfer,
    showToast,
    queryClient,
    eventId,
  ]);

  // ── Refund eligibility (>24h before event) ──
  const refundEligible = useMemo(() => {
    if (!dbTicket?.event_date) return false;
    const msUntilEvent = new Date(dbTicket.event_date).getTime() - Date.now();
    return msUntilEvent > 24 * 60 * 60 * 1000;
  }, [dbTicket?.event_date]);

  const handleRefund = useCallback(async () => {
    if (!dbTicket?.id || refundStep === "loading") return;
    setRefundStep("loading");
    const res =
      dbTicket.cart_id && dbTicket.cart_line_item_id
        ? await ticketsApi.requestLineRefund({
            cartId: dbTicket.cart_id,
            lineItemId: dbTicket.cart_line_item_id,
          })
        : await ticketsApi.requestRefund(dbTicket.id);
    if ("error" in res && res.error) {
      setRefundStep("confirm");
      showToast("error", "Refund failed", res.error);
      return;
    }
    const refundMessage = "message" in res ? res.message : undefined;
    showToast(
      "success",
      "Ticket cancelled",
      refundMessage || "Refund processed successfully",
    );
    await queryClient.invalidateQueries({
      queryKey: ticketKeys.myTicketForEvent(eventId),
    });
    await queryClient.invalidateQueries({ queryKey: ticketKeys.myTickets() });
    setRefundStep("idle");
    router.back();
  }, [
    dbTicket?.cart_id,
    dbTicket?.cart_line_item_id,
    dbTicket?.id,
    refundStep,
    setRefundStep,
    showToast,
    queryClient,
    eventId,
    router,
  ]);

  // ── Share ──
  const handleShare = useCallback(async () => {
    if (!ticket || shareState === "loading") return;
    setShareState("loading");
    const shareUrl =
      typeof window !== "undefined" ? window.location.href : "";
    const text = `My ticket for ${ticket.eventTitle || "an event"} on DVNT`;
    try {
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({
          title: ticket.eventTitle || "DVNT Ticket",
          text,
          url: shareUrl,
        });
      } else if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(shareUrl);
        showToast("success", "Link copied", "Ticket link copied to clipboard");
      }
      setShareState("idle");
    } catch {
      setShareState("idle");
    }
  }, [ticket, shareState, setShareState, showToast]);

  // ── Calendar (download .ics) ──
  const handleCalendar = useCallback(() => {
    if (!ticket?.eventDate) return;
    const start = new Date(ticket.eventDate);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//DVNT//Ticket//EN",
      "BEGIN:VEVENT",
      `UID:${ticket.id}@dvnt`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${ticket.eventTitle || "DVNT Event"}`,
      ticket.eventLocation ? `LOCATION:${ticket.eventLocation}` : "",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(ticket.eventTitle || "event").replace(/\s+/g, "-")}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "Calendar", "Event downloaded to your calendar");
  }, [ticket, showToast]);

  // ── Transfer (send) — search + initiate ──
  const { data: transferSearchData, isFetching: isSearchingUsers } =
    useSearchUsers(transferQuery);
  const transferResults: any[] = transferSearchData?.docs ?? [];

  const handleTransferToUser = useCallback(
    async (recipientUsername: string) => {
      if (!recipientUsername || !ticket) return;
      setShowTransferModal(false);
      setTransferState("loading");
      const result = await ticketsApi.initiateTransfer(
        ticket.id,
        recipientUsername,
      );
      if (result.error) {
        setTransferState("error");
        showToast("error", "Transfer Failed", result.error);
        setTimeout(() => setTransferState("idle"), 3000);
      } else {
        setTransferState("success");
        showToast(
          "success",
          "Transfer Initiated",
          `Waiting for @${recipientUsername} to accept (expires in 24h)`,
        );
        await queryClient.invalidateQueries({
          queryKey: ticketKeys.myTicketForEvent(eventId),
        });
        setTimeout(() => setTransferState("idle"), 3000);
      }
    },
    [
      ticket,
      setShowTransferModal,
      setTransferState,
      showToast,
      queryClient,
      eventId,
    ],
  );

  // ── Loading ──
  if (isLoading && !ticket) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <div className="mx-auto w-full max-w-xl px-4 py-6">
          <div className="h-64 animate-pulse rounded-3xl border border-white/8 bg-white/4" />
          <div className="mt-6 h-72 animate-pulse rounded-3xl border border-white/8 bg-white/4" />
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (!ticket) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur">
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <ArrowLeft size={18} color="#fff" />
          </button>
          <h1 className="flex-1 text-[17px] font-semibold">Ticket</h1>
        </div>
        <div className="flex flex-col items-center justify-center px-8 py-32 text-center">
          <TicketX size={56} color="rgba(255,255,255,0.2)" />
          <p className="mt-4 text-xl font-bold text-white">Ticket Not Found</p>
          <p className="mt-1 max-w-xs text-sm text-white/40">
            This ticket may have been removed or is no longer available.
          </p>
          <button
            onClick={() => router.back()}
            className="mt-6 rounded-full bg-cyan-500 px-6 py-2.5 text-sm font-semibold text-black"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const tier = ticket.tier || "ga";
  const accent = TIER_ACCENT[tier];
  const config = TIER_CONFIG[tier];
  const TierIcon = config.Icon;
  const isExpired = ticket.status === "expired";
  const isRevoked = ticket.status === "revoked";
  const isTransferPending = ticket.status === "transfer_pending";
  const isCheckedIn = ticket.status === "checked_in";
  const isActive = ticket.status === "valid";
  const isBlocked = isRevoked || isExpired || isCheckedIn;
  const heroImage = resolveImageUrl(ticket.eventImage);

  // Access details (only render rows that exist)
  const accessRows: { Icon: typeof Clock; label: string; value: string }[] = [];
  if (ticket.entryWindow)
    accessRows.push({
      Icon: Clock,
      label: "Entry Window",
      value: ticket.entryWindow,
    });
  if (ticket.tableNumber)
    accessRows.push({
      Icon: Hash,
      label: "Table",
      value: `Table ${ticket.tableNumber}`,
    });
  if (ticket.dressCode)
    accessRows.push({
      Icon: Shirt,
      label: "Dress Code",
      value: ticket.dressCode,
    });
  if (ticket.doorPolicy)
    accessRows.push({
      Icon: ShieldCheck,
      label: "Door Policy",
      value: ticket.doorPolicy,
    });
  const hasAccessDetails =
    accessRows.length > 0 || (ticket.perks && ticket.perks.length > 0);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <header
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
        <h1 className="flex-1 truncate text-[17px] font-semibold">
          {ticket.eventTitle || "Ticket"}
        </h1>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 pb-40 pt-4">
        {/* ── 1. HERO CARD ── */}
        <section
          className={`relative overflow-hidden rounded-3xl ${
            isBlocked ? "opacity-60" : ""
          }`}
          style={{ minHeight: 260 }}
        >
          {heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImage}
              alt={ticket.eventTitle || "Event"}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ filter: "blur(8px)", transform: "scale(1.1)" }}
            />
          ) : null}
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.7), rgba(0,0,0,0.92))",
            }}
          />
          <div className="relative flex min-h-[260px] flex-col justify-end gap-2 p-6">
            <span
              className="flex items-center gap-1.5 self-start rounded-full px-3 py-1.5"
              style={{ backgroundColor: config.badgeBg }}
            >
              <TierIcon size={12} color={accent} />
              <span
                className="text-[11px] font-extrabold tracking-[1.5px]"
                style={{ color: accent }}
              >
                {ticket.tierName || config.label}
              </span>
            </span>
            <h2 className="text-[28px] font-extrabold leading-8 tracking-tight text-white">
              {ticket.eventTitle || ticket.eventId}
            </h2>
            <div className="mt-1 flex flex-col gap-0.5">
              {ticket.eventDate ? (
                <p className="text-sm font-semibold text-white/70">
                  {formatDate(ticket.eventDate)}
                </p>
              ) : null}
              {ticket.eventDate ? (
                <p className="text-sm font-semibold text-white/70">
                  {formatTime(ticket.eventDate)}
                </p>
              ) : null}
              {ticket.eventLocation ? (
                <p className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-white/50">
                  <MapPin size={12} color="rgba(255,255,255,0.5)" />
                  {ticket.eventLocation}
                </p>
              ) : null}
            </div>
            {ticket.promoter ? (
              <p className="mt-0.5 text-xs font-semibold italic text-white/45">
                Guest of @{ticket.promoter}
              </p>
            ) : null}
          </div>
        </section>

        {/* ── Transfer pending banner ── */}
        {isTransferPending ? (
          <div
            className="mt-4 flex items-center gap-2 rounded-2xl border px-4 py-3"
            style={{
              backgroundColor: "rgba(138,64,207,0.12)",
              borderColor: "rgba(138,64,207,0.2)",
            }}
          >
            <Shield size={16} color="#8A40CF" />
            <span className="flex-1 text-[13px] font-semibold text-[#C084FC]">
              Transfer pending — waiting for recipient to accept
            </span>
            {outgoingTransfer ? (
              <button
                onClick={handleCancelTransfer}
                disabled={cancelingTransfer}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-[#C084FC] disabled:opacity-50"
                style={{ backgroundColor: "rgba(138,64,207,0.25)" }}
              >
                {cancelingTransfer ? "..." : "Cancel"}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── Expired / revoked banner ── */}
        {isExpired || isRevoked ? (
          <div
            className="mt-4 flex items-center gap-2 rounded-2xl border px-4 py-3"
            style={{
              backgroundColor: isRevoked
                ? "rgba(239,68,68,0.12)"
                : "rgba(163,163,163,0.1)",
              borderColor: isRevoked
                ? "rgba(239,68,68,0.2)"
                : "rgba(163,163,163,0.15)",
            }}
          >
            <Shield size={16} color={isRevoked ? "#ef4444" : "#a3a3a3"} />
            <span
              className="text-[13px] font-semibold"
              style={{ color: isRevoked ? "#ef4444" : "#a3a3a3" }}
            >
              {isRevoked
                ? "This ticket has been revoked"
                : "This event has ended"}
            </span>
          </div>
        ) : null}

        {/* ── Tear separator ── */}
        <div className="my-3 flex items-center gap-1 px-2">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="h-0.5 flex-1 rounded-full"
              style={{ backgroundColor: `${accent}30` }}
            />
          ))}
        </div>

        {/* ── 2. QR ZONE ── */}
        <section className="flex flex-col items-center gap-3 py-6">
          <span className="text-[11px] font-bold tracking-[2px] text-white/35">
            PRESENT AT DOOR
          </span>
          <div className="relative rounded-3xl bg-[#0a0a0a] p-6">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="Ticket QR code"
                width={220}
                height={220}
                className="rounded-xl"
                style={{ display: "block" }}
              />
            ) : (
              <div className="h-[220px] w-[220px] animate-pulse rounded-xl bg-white/10" />
            )}
            {isBlocked ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-black/85">
                {isCheckedIn ? (
                  <>
                    <CheckCircle2 size={28} color="#3FDCFF" />
                    <span className="text-base font-bold text-[#3FDCFF]">
                      Checked In
                    </span>
                  </>
                ) : isRevoked ? (
                  <>
                    <XCircle size={28} color="#FC253A" />
                    <span className="text-base font-bold text-[#FC253A]">
                      Revoked
                    </span>
                  </>
                ) : (
                  <>
                    <Lock size={28} color="#a3a3a3" />
                    <span className="text-base font-bold text-[#a3a3a3]">
                      Expired
                    </span>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {isCheckedIn && ticket.checkedInAt ? (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#3FDCFF]">
              <CheckCircle2 size={14} color="#3FDCFF" />
              Checked in at {formatTime(ticket.checkedInAt)}
            </span>
          ) : isActive ? (
            <span className="text-[13px] font-medium text-white/45">
              Present this at the door
            </span>
          ) : null}
          <span className="font-mono text-[11px] font-bold tracking-[2px] text-white/25">
            {ticket.id.slice(0, 12).toUpperCase()}
          </span>
        </section>

        {/* ── Transferable label ── */}
        <div className="mb-5 flex justify-center">
          <span
            className="rounded-full border px-3.5 py-1 text-[11px] font-bold tracking-wide"
            style={{
              borderColor: (ticket.transferable ?? true)
                ? "rgba(63,220,255,0.2)"
                : "rgba(255,255,255,0.08)",
              color: (ticket.transferable ?? true)
                ? "#3FDCFF"
                : "rgba(255,255,255,0.25)",
            }}
          >
            {(ticket.transferable ?? true) ? "Transferable" : "Non-transferable"}
          </span>
        </div>

        {/* ── 2.5 UPGRADE CARD ── */}
        {isActive && upgradeTiers.length > 0
          ? (() => {
              const cheapest = upgradeTiers[0];
              const diffDollars = Math.max(
                0,
                ((cheapest.price_cents ?? 0) -
                  (dbTicket?.purchase_amount_cents ?? 0)) /
                  100,
              );
              const extraCount = upgradeTiers.length - 1;
              return (
                <div
                  className="mb-5 flex flex-col gap-2 rounded-3xl border p-4"
                  style={{
                    backgroundColor: "rgba(138,64,207,0.12)",
                    borderColor: "rgba(192,132,252,0.30)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[1.2px] text-[#C084FC]"
                      style={{ backgroundColor: "rgba(192,132,252,0.18)" }}
                    >
                      <Sparkles size={12} color="#C084FC" />
                      UPGRADE AVAILABLE
                    </span>
                    <span className="text-[22px] font-extrabold tracking-tight text-[#C084FC] tabular-nums">
                      +${diffDollars.toFixed(diffDollars % 1 === 0 ? 0 : 2)}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-white">{cheapest.name}</p>
                  <p className="text-xs leading-4 text-white/55">
                    Pay only the difference · Wallet updates automatically
                  </p>
                  <button
                    onClick={() =>
                      router.push(`/feed/ticket/upgrade/${eventId}`)
                    }
                    aria-label={`Upgrade to ${cheapest.name}`}
                    className="mt-1 flex h-12 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-extrabold text-black active:opacity-85"
                    style={{ backgroundColor: "#C084FC" }}
                  >
                    Upgrade to {cheapest.name}
                    <ChevronRight size={18} color="#000" strokeWidth={2.5} />
                  </button>
                  {extraCount > 0 ? (
                    <button
                      onClick={() =>
                        router.push(`/feed/ticket/upgrade/${eventId}`)
                      }
                      className="py-1 text-center text-xs font-semibold text-[#C084FC]/85 active:opacity-70"
                    >
                      +{extraCount} more {extraCount === 1 ? "tier" : "tiers"}{" "}
                      available
                    </button>
                  ) : null}
                </div>
              );
            })()
          : null}

        {/* ── 2.7 ADD-ONS — link to event detail ── */}
        {isActive && eventId ? (
          <button
            onClick={() => router.push(`/feed/events/${eventId}`)}
            aria-label="Add more for this event"
            className="mb-4 flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left active:opacity-85"
            style={{
              backgroundColor: "rgba(255,109,193,0.10)",
              borderColor: "rgba(255,109,193,0.30)",
            }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ backgroundColor: "rgba(255,109,193,0.18)" }}
            >
              <Sparkles size={18} color="rgb(255,109,193)" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-white">
                Add more for this event
              </span>
              <span className="mt-0.5 block text-xs text-white/55">
                Coat check, drinks, extra tickets — pay in one go
              </span>
            </span>
            <ChevronRight size={18} color="rgb(255,109,193)" />
          </button>
        ) : null}

        {/* ── 3. ACCESS DETAILS ── */}
        {hasAccessDetails ? (
          <section className="mb-4 flex flex-col gap-2.5">
            <span className="ml-1 text-[11px] font-bold tracking-[2px] text-white/35">
              ACCESS DETAILS
            </span>
            <div className="flex flex-col gap-3.5 rounded-3xl border border-white/6 bg-white/4 p-4">
              {accessRows.map((row, i) => {
                const RowIcon = row.Icon;
                return (
                  <div key={i} className="flex gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/6">
                      <RowIcon size={16} color={accent} />
                    </span>
                    <span className="flex flex-1 flex-col gap-0.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                        {row.label}
                      </span>
                      <span className="text-sm font-semibold text-white">
                        {row.value}
                      </span>
                    </span>
                  </div>
                );
              })}
              {ticket.perks && ticket.perks.length > 0 ? (
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/6">
                    <Sparkles size={16} color={accent} />
                  </span>
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                      Included
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {ticket.perks.map((perk, i) => (
                        <span
                          key={i}
                          className="rounded-xl border px-2.5 py-1 text-xs font-semibold"
                          style={{
                            borderColor: `${accent}30`,
                            color: accent,
                          }}
                        >
                          {perk}
                        </span>
                      ))}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ── Danger zone: refund (>24h) ── */}
        {isActive && dbTicket && refundEligible ? (
          <div className="mt-2 flex flex-col items-center">
            {refundStep === "idle" ? (
              <button
                onClick={() => setRefundStep("confirm")}
                className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-semibold text-[#ef4444] active:opacity-75"
                style={{ borderColor: "rgba(239,68,68,0.22)" }}
              >
                <TicketX size={15} color="#ef4444" />
                Request Refund
              </button>
            ) : refundStep === "confirm" ? (
              <div
                className="flex w-full flex-col gap-2.5 rounded-2xl border p-4"
                style={{
                  backgroundColor: "rgba(239,68,68,0.06)",
                  borderColor: "rgba(239,68,68,0.18)",
                }}
              >
                <p className="text-[15px] font-bold text-white">
                  Cancel this ticket?
                </p>
                <p className="text-[13px] leading-[18px] text-white/50">
                  {dbTicket.cart_id && dbTicket.cart_line_item_id
                    ? "This cancels every ticket or pass from this cart line. Other items from the same checkout stay active."
                    : (dbTicket.purchase_amount_cents ?? 0) > 0
                      ? "A refund will be issued to your original payment method. Funds typically appear within 5–10 business days."
                      : "Your free ticket will be cancelled. This cannot be undone."}
                </p>
                <div className="mt-1 flex gap-2.5">
                  <button
                    onClick={() => setRefundStep("idle")}
                    className="flex-1 rounded-xl bg-white/6 py-2.5 text-sm font-semibold text-white/70"
                  >
                    Keep Ticket
                  </button>
                  <button
                    onClick={handleRefund}
                    className="flex-1 rounded-xl py-2.5 text-sm font-bold text-[#ef4444]"
                    style={{ backgroundColor: "rgba(239,68,68,0.18)" }}
                  >
                    Yes, Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 py-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#ef4444] border-t-transparent" />
                <span className="text-[13px] text-white/50">
                  Processing refund...
                </span>
              </div>
            )}
          </div>
        ) : null}
      </main>

      {/* ── Sticky bottom actions (only for active tickets) ── */}
      {isActive ? (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-white/8 bg-[#06070d]/96 backdrop-blur"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
        >
          <div className="mx-auto flex w-full max-w-xl gap-2.5 px-4 pt-3">
            {/* Calendar */}
            <button
              onClick={handleCalendar}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/6 py-3.5 text-[13px] font-bold text-white active:opacity-85"
            >
              <CalendarPlus size={16} color="#fff" />
              Calendar
            </button>
            {/* Share */}
            <button
              onClick={handleShare}
              disabled={shareState === "loading"}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-[13px] font-bold active:opacity-85 disabled:opacity-60"
              style={{ backgroundColor: `${accent}20`, color: accent }}
            >
              <Share2 size={16} color={accent} />
              Share
            </button>
            {/* Transfer */}
            <button
              onClick={() => {
                setTransferQuery("");
                setShowTransferModal(true);
              }}
              disabled={transferState === "loading"}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3.5 text-[13px] font-bold text-white active:opacity-85 disabled:opacity-60 ${
                transferState === "success" ? "bg-cyan-500/10" : "bg-white/6"
              }`}
            >
              {transferState === "success" ? (
                <CheckCircle2 size={16} color="#3FDCFF" />
              ) : (
                <Send size={16} color="#fff" />
              )}
              {transferState === "loading"
                ? "..."
                : transferState === "success"
                  ? "Sent"
                  : "Transfer"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Transfer dialog — kit Dialog ── */}
      <Dialog
        open={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title="Transfer Ticket"
      >
        <p className="mb-4 text-[13px] leading-[18px] text-white/50">
          Search by username or name. Tap a result to send the ticket.
        </p>
        <input
          value={transferQuery}
          onChange={(e) => setTransferQuery(e.target.value)}
          placeholder="Search users"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          className="mb-4 w-full rounded-xl border border-white/10 bg-white/6 px-4 py-3 text-[15px] text-white placeholder:text-white/30 outline-none focus:border-cyan-500/60"
        />
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {transferQuery.length === 0 ? (
            <p className="py-5 text-center text-[13px] text-white/45">
              Type to find a friend
            </p>
          ) : isSearchingUsers && transferResults.length === 0 ? (
            <p className="py-5 text-center text-[13px] text-white/45">
              Searching…
            </p>
          ) : transferResults.length === 0 ? (
            <p className="py-5 text-center text-[13px] text-white/45">
              No users matching “{transferQuery}”
            </p>
          ) : (
            transferResults.slice(0, 6).map((u: any) => {
              const avatarUrl = resolveImageUrl(u.avatar);
              return (
                <button
                  key={u.id}
                  onClick={() => handleTransferToUser(u.username)}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-left active:bg-white/6"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={u.username}
                      className="h-10 w-10 shrink-0 rounded-xl object-cover bg-white/10"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-white/60">
                      {(u.username || "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold text-white">
                      {u.name}
                    </span>
                    <span className="truncate text-sm font-bold text-white/70">
                      @{u.username}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Dialog>
    </div>
  );
}

export default TicketDetailScreen;
