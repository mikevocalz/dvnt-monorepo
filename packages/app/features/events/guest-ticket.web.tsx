"use client";

/**
 * Guest Ticket — web (port of native
 * `app/(public)/tickets/guest/[token].tsx`).
 *
 * A public, no-login view of a ticket reached via the magic link emailed to
 * non-authenticated buyers. The caller is authorised purely by possessing the
 * share token. Shows the event header, tier, QR code, status, and a sign-up
 * nudge so guests can convert to a full account later.
 *
 * Law 1 (data wiring is sacred): the ticket is fetched from the EXACT native
 * edge function `get-guest-ticket` via `invokeEdge(..., { requireAuth: false })`,
 * keyed by the share token, under the same `["guest-ticket", token]` query key.
 * The sign-up nudge opens the same public gate native uses
 * (`usePublicGateStore.openGate("create")`).
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No View/Text.
 *
 * QR on web: native renders react-native-qrcode-svg (native only). Here we
 * generate a data url with the installed `qrcode` package and render <img>.
 *
 * Transient UI (QR data url + load state) lives in a tiny Zustand store
 * (`guest-ticket-ui-store`) — never useState.
 */

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — `qrcode` ships without bundled types in this monorepo.
import QRCode from "qrcode";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  LogIn,
  MapPin,
  Ticket as TicketIcon,
} from "lucide-react";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";
import { useGuestTicketUIStore } from "@dvnt/app/lib/stores/guest-ticket-ui-store";

interface GuestTicketData {
  ok: boolean;
  ticket: {
    id: string;
    status: string;
    qrToken: string;
    qrPayload: string | null;
    checkedInAt: string | null;
    purchaseAmountCents: number;
    tierName: string | null;
    guestEmail: string | null;
    guestName: string | null;
    event: {
      id: string;
      title: string;
      startDate: string | null;
      endDate: string | null;
      location: string | null;
      coverImageUrl: string | null;
    };
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function GuestTicketScreen() {
  const params = useParams<{ token: string | string[] }>();
  const router = useRouter();
  const openGate = usePublicGateStore((s) => s.openGate);

  const rawToken = params?.token;
  const token = Array.isArray(rawToken) ? (rawToken[0] ?? "") : (rawToken ?? "");

  // ── Ticket data — EXACT native edge fn via invokeEdge, same query key ──
  const { data, isLoading, isError, refetch } = useQuery<GuestTicketData | null>(
    {
      queryKey: ["guest-ticket", token],
      queryFn: async () => {
        if (!token) return null;
        const { data } = await invokeEdge<GuestTicketData>(
          "get-guest-ticket",
          { token },
          { requireAuth: false },
        );
        return data ?? null;
      },
      enabled: !!token,
      staleTime: 60 * 1000,
    },
  );

  // Phase 2 — live: a host edit (time/venue/cancel) refetches the guest ticket
  // so the holder's no-login view reflects it. Anon Realtime is RLS-scoped, so
  // this updates for public events (the common guest case).
  const liveEventId = data?.ticket?.event?.id ? String(data.ticket.event.id) : "";
  useEffect(() => {
    if (!liveEventId) return;
    const ch = supabase
      .channel(`guest-ticket-rt:${liveEventId}:${token}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${liveEventId}` },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [liveEventId, token, refetch]);

  // ── Transient UI (Zustand, never useState) ──
  const qrDataUrl = useGuestTicketUIStore((s) => s.qrDataUrl);
  const setQr = useGuestTicketUIStore((s) => s.setQr);
  const resetUI = useGuestTicketUIStore((s) => s.reset);

  useEffect(() => {
    resetUI();
    return () => resetUI();
  }, [token, resetUI]);

  // ── Generate QR data url from the token (async → Zustand) ──
  const qrToken = data?.ticket?.qrToken || "";
  useEffect(() => {
    let cancelled = false;
    if (!qrToken) {
      setQr(null, "idle");
      return;
    }
    setQr(null, "loading");
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
        if (!cancelled) setQr(url, "ready");
      })
      .catch(() => {
        if (!cancelled) setQr(null, "error");
      });
    return () => {
      cancelled = true;
    };
  }, [qrToken, setQr]);

  const handleClose = useCallback(() => router.back(), [router]);
  const handleSignUp = useCallback(() => openGate("create"), [openGate]);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <div className="mx-auto w-full max-w-xl px-4 py-6">
          <div className="h-64 animate-pulse rounded-3xl border border-white/8 bg-white/4" />
          <div className="mt-6 h-72 animate-pulse rounded-3xl border border-white/8 bg-white/4" />
        </div>
      </div>
    );
  }

  // ── Error / unavailable ──
  if (isError || !data?.ok || !data.ticket) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <header
          className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/6 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
        >
          <button
            onClick={handleClose}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <ArrowLeft size={18} color="#fff" />
          </button>
          <h1 className="flex-1 truncate text-[17px] font-bold">Ticket</h1>
        </header>
        <div className="flex flex-col items-center justify-center gap-2.5 px-8 py-32 text-center">
          <AlertCircle size={40} color="rgba(255,255,255,0.4)" />
          <p className="text-[17px] font-bold text-white">Ticket unavailable</p>
          <p className="max-w-xs text-[13px] leading-[18px] text-white/55">
            The link may have expired, been used, or copied incorrectly. Try
            reopening the link from your email.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-2.5 rounded-xl border border-white/25 px-[18px] py-2.5 text-sm font-semibold text-white active:opacity-75"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { ticket } = data;
  const { event } = ticket;
  const checkedIn = !!ticket.checkedInAt || ticket.status === "scanned";
  const revoked = ticket.status === "refunded" || ticket.status === "void";
  const dateLabel = formatDate(event.startDate);
  const buyer = ticket.guestName || ticket.guestEmail;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/6 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={handleClose}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="flex-1 truncate text-[17px] font-bold">
          {event.title || "Ticket"}
        </h1>
      </header>

      <main className="mx-auto w-full max-w-xl px-5 pb-10">
        {/* Cover image — rounded square */}
        {event.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.coverImageUrl}
            alt={event.title || "Event"}
            className="mt-4 aspect-square w-full rounded-2xl object-cover"
          />
        ) : null}

        <div className="flex flex-col gap-3 pt-5">
          <h2 className="text-2xl font-extrabold tracking-tight text-white">
            {event.title || "Your ticket"}
          </h2>

          {dateLabel ? (
            <div className="flex items-center gap-2">
              <Calendar size={15} color="rgba(255,255,255,0.55)" />
              <span className="flex-1 text-sm text-white/75">{dateLabel}</span>
            </div>
          ) : null}

          {event.location ? (
            <div className="flex items-center gap-2">
              <MapPin size={15} color="rgba(255,255,255,0.55)" />
              <span className="flex-1 text-sm text-white/75">
                {event.location}
              </span>
            </div>
          ) : null}

          {/* Tier + buyer */}
          <div className="mt-2 flex items-center gap-2.5">
            <span
              className="flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5"
              style={{
                backgroundColor: "rgba(99,102,241,0.25)",
                borderColor: "rgba(99,102,241,0.45)",
              }}
            >
              <TicketIcon size={13} color="#fff" />
              <span className="text-xs font-bold text-white">
                {ticket.tierName ?? "General"}
              </span>
            </span>
            {buyer ? (
              <span className="flex-1 truncate text-xs text-white/50">
                {buyer}
              </span>
            ) : null}
          </div>

          {/* Status banner */}
          {revoked ? (
            <div
              className="mt-2 flex items-center gap-2.5 rounded-2xl border px-3.5 py-3"
              style={{
                backgroundColor: "rgba(239,68,68,0.12)",
                borderColor: "rgba(239,68,68,0.3)",
              }}
            >
              <AlertCircle size={16} color="#ef4444" />
              <span className="flex-1 text-[13px] font-semibold text-[#ef4444]">
                This ticket has been refunded and is no longer valid.
              </span>
            </div>
          ) : checkedIn ? (
            <div
              className="mt-2 flex items-center gap-2.5 rounded-2xl border px-3.5 py-3"
              style={{
                backgroundColor: "rgba(34,197,94,0.12)",
                borderColor: "rgba(34,197,94,0.3)",
              }}
            >
              <CheckCircle2 size={16} color="#22c55e" />
              <span className="flex-1 text-[13px] font-semibold text-[#22c55e]">
                Checked in — welcome!
              </span>
            </div>
          ) : null}

          {/* QR card */}
          {!revoked ? (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-[20px] bg-white p-5">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="Ticket QR code"
                  width={260}
                  height={260}
                  className="block rounded-xl"
                />
              ) : (
                <div className="h-[260px] w-[260px] animate-pulse rounded-xl bg-black/10" />
              )}
              <span className="text-[13px] font-semibold text-[#111]">
                Show this code at the door.
              </span>
              <span className="truncate font-mono text-[10px] tracking-[0.5px] text-[#666]">
                {ticket.qrToken}
              </span>
            </div>
          ) : null}

          {/* Sign-up nudge */}
          <div className="mt-5 flex flex-col gap-1.5 rounded-2xl border border-white/8 bg-white/4 p-4">
            <span className="text-[15px] font-bold text-white">
              Want to manage tickets?
            </span>
            <span className="mb-1.5 text-[13px] leading-[18px] text-white/60">
              Create a free account to add this ticket to Apple/Google Wallet,
              get push reminders, and transfer it to a friend.
            </span>
            <button
              onClick={handleSignUp}
              className="flex items-center justify-center gap-1.5 self-start rounded-xl bg-white px-4 py-2.5 active:opacity-85"
            >
              <LogIn size={14} color="#000" />
              <span className="text-[13px] font-extrabold text-black">
                Create account
              </span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default GuestTicketScreen;
