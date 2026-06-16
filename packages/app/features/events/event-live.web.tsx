"use client";

/**
 * Event War Room (Live) — WEB port of native
 * `app/(protected)/events/[id]/live.tsx`.
 *
 * This is the live event-day operations dashboard (NOT a video room): a host's
 * read-only view during an active event combining sold / scanned / scan-rate
 * hero stats, a 30-minute scans-per-minute bar chart, and a realtime feed of
 * the last ~20 check-ins.
 *
 * Law 1 (data flow is sacred): consumes the EXACT same data path as native.
 *   - Initial counts via the `supabase` client against the `tickets` table —
 *     three index-friendly count queries (sold / scanned / refunded), the
 *     identical `.eq("event_id", …)` + `.in/.eq("status", …)` filters native
 *     uses.
 *   - Recent scans (last 60 min) via the same `tickets` select for the chart
 *     buckets + feed.
 *   - Realtime Postgres subscription on the SAME channel id shape
 *     (`event-live:${eventId}:${Date.now()}`) with the SAME INSERT + UPDATE
 *     handlers filtered by `event_id=eq.${eventId}`: status flipping to
 *     'scanned' appends to the live feed and bumps the current-minute bucket;
 *     INSERT bumps sold; UPDATE → 'refunded' bumps refunded.
 *   - Slow 30s polling fallback + 60s bucket-slide, identical to native.
 *   - Permission scope (owner/admin/editor/scanner) resolved from the
 *     `ticketsApi.getEventTicketsPaginated` edge fn's effective `role` — the
 *     page is read-only and gated to those roles.
 *
 * Law 2 (web lists = TanStack Virtual): the recent check-in feed renders
 * through `@tanstack/react-virtual` — never FlatList / FlashList.
 *
 * Law 3 (presentation): raw semantic HTML + Tailwind only (NativeWind interop
 * is off) — no <View>/<Text>. Charts are raw CSS/SVG bars (like
 * analytics.web.tsx), NO native chart lib. Sticky glass header ("Live" + event
 * name) like legal-page.web.tsx. Avatars / tiles are rounded squares. State is
 * Zustand, never useState. Navigation via Solito; id via useParams. bg
 * #06070d, accent cyan #3FDCFF, live badge rose, content max-w-2xl.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Radio, ScanLine } from "lucide-react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import {
  useEventLiveWarRoomStore,
  BUCKET_COUNT,
  type ScanRow,
} from "@dvnt/app/lib/stores/event-live-warroom-store";

// ── Pure helpers (identical to native) ──────────────────────────────────
function bucketIndexFor(ts: number, now: number): number {
  // Bucket 0 = oldest, bucket BUCKET_COUNT-1 = most recent (current minute).
  const minutesAgo = Math.floor((now - ts) / 60_000);
  if (minutesAgo < 0) return BUCKET_COUNT - 1;
  if (minutesAgo >= BUCKET_COUNT) return -1;
  return BUCKET_COUNT - 1 - minutesAgo;
}

function formatClock(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

// Roles that may view the war room (read-only). Mirrors native scope.
const ALLOWED_ROLES = new Set(["owner", "admin", "editor", "scanner"]);

const FEED_ROW_HEIGHT = 56;

// ── Hero stat tile ──────────────────────────────────────────────────────
function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-2xl border border-white/8 bg-white/4 px-3 py-3.5">
      <span className="text-[22px] font-bold leading-none tracking-tight text-white">
        {value}
      </span>
      <span
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {label}
      </span>
    </div>
  );
}

export function EventLiveScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);

  // ── All state in Zustand (never useState) ─────────────────────────────
  const eventTitle = useEventLiveWarRoomStore((s) => s.eventTitle);
  const sold = useEventLiveWarRoomStore((s) => s.sold);
  const scannedCount = useEventLiveWarRoomStore((s) => s.scannedCount);
  const refunded = useEventLiveWarRoomStore((s) => s.refunded);
  const recent = useEventLiveWarRoomStore((s) => s.recent);
  const buckets = useEventLiveWarRoomStore((s) => s.buckets);
  const connected = useEventLiveWarRoomStore((s) => s.connected);
  const loading = useEventLiveWarRoomStore((s) => s.loading);
  const role = useEventLiveWarRoomStore((s) => s.role);
  const permissionDenied = useEventLiveWarRoomStore((s) => s.permissionDenied);

  const setEventTitle = useEventLiveWarRoomStore((s) => s.setEventTitle);
  const setSold = useEventLiveWarRoomStore((s) => s.setSold);
  const setScannedCount = useEventLiveWarRoomStore((s) => s.setScannedCount);
  const setRefunded = useEventLiveWarRoomStore((s) => s.setRefunded);
  const setRecent = useEventLiveWarRoomStore((s) => s.setRecent);
  const setBuckets = useEventLiveWarRoomStore((s) => s.setBuckets);
  const setConnected = useEventLiveWarRoomStore((s) => s.setConnected);
  const setLoading = useEventLiveWarRoomStore((s) => s.setLoading);
  const setRole = useEventLiveWarRoomStore((s) => s.setRole);
  const setPermissionDenied = useEventLiveWarRoomStore(
    (s) => s.setPermissionDenied,
  );
  const reset = useEventLiveWarRoomStore((s) => s.reset);

  // Reset the singleton store when the screen unmounts so a re-entry starts
  // clean (mirrors native component-state lifecycle).
  useEffect(() => {
    return () => {
      reset();
    };
  }, [reset]);

  // ── Cheap aggregate counts — three index-friendly count queries ───────
  const refreshCounts = useCallback(async () => {
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    const [{ count: soldCount }, { count: doneCount }, { count: refCount }] =
      await Promise.all([
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .in("status", ["active", "transfer_pending", "scanned"]),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "scanned"),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "refunded"),
      ]);
    setSold(soldCount || 0);
    setScannedCount(doneCount || 0);
    setRefunded(refCount || 0);
  }, [eventId, setSold, setScannedCount, setRefunded]);

  // ── Permission gate — resolve effective role via the tickets edge fn ──
  // The edge fn returns the caller's effective role (owner/admin/editor/
  // scanner) or null if they have no scope on the event. Read-only page.
  useEffect(() => {
    let cancelled = false;
    if (!Number.isFinite(eventId) || eventId <= 0) {
      setPermissionDenied(true);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const page = await ticketsApi.getEventTicketsPaginated(
          String(eventId),
          { page: 1, pageSize: 1, status: "all" },
        );
        if (cancelled) return;
        setRole(page.role);
        if (!page.role || !ALLOWED_ROLES.has(page.role)) {
          setPermissionDenied(true);
          setLoading(false);
        }
      } catch {
        if (cancelled) return;
        setPermissionDenied(true);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, setRole, setPermissionDenied, setLoading]);

  const hasAccess = !!role && ALLOWED_ROLES.has(role);

  // ── Initial bootstrap: event title, counts, last hour of scans ────────
  useEffect(() => {
    let cancelled = false;
    if (!hasAccess) return;
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    (async () => {
      try {
        const { data: ev } = await supabase
          .from("events")
          .select("id, title")
          .eq("id", eventId)
          .maybeSingle();
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setEventTitle((ev as any)?.title || null);

        await refreshCounts();

        // Recent scans (last 60 min) for chart + feed.
        const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: scans } = await supabase
          .from("tickets")
          .select("id, checked_in_at, qr_token, ticket_types(name)")
          .eq("event_id", eventId)
          .eq("status", "scanned")
          .gte("checked_in_at", sinceIso)
          .order("checked_in_at", { ascending: false })
          .limit(200);
        if (cancelled) return;

        const now = Date.now();
        const newBuckets = Array<number>(BUCKET_COUNT).fill(0);
        const feed: ScanRow[] = [];
        for (const s of scans || []) {
          const ts = s.checked_in_at
            ? new Date(s.checked_in_at).getTime()
            : 0;
          const bi = bucketIndexFor(ts, now);
          if (bi >= 0) newBuckets[bi] += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ttRaw: any = (s as any).ticket_types;
          const tierName = Array.isArray(ttRaw) ? ttRaw[0]?.name : ttRaw?.name;
          feed.push({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            id: (s as any).id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            checked_in_at: (s as any).checked_in_at,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            qr_token: (s as any).qr_token,
            ticket_type_name: tierName,
          });
        }
        setBuckets(newBuckets);
        setRecent(feed.slice(0, 20));
      } catch (err) {
        console.error("[live] bootstrap failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    hasAccess,
    eventId,
    refreshCounts,
    setEventTitle,
    setBuckets,
    setRecent,
    setLoading,
  ]);

  // ── Realtime subscription on tickets INSERT + UPDATE ──────────────────
  useEffect(() => {
    if (!hasAccess) return;
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    const channelId = `event-live:${eventId}:${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      // New ticket issued — bump sold count immediately so the host watching
      // the room fill up doesn't have to wait for the 30s poll.
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${eventId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const next = payload?.new;
          if (!next) return;
          if (
            next.status === "active" ||
            next.status === "transfer_pending" ||
            next.status === "scanned"
          ) {
            setSold((c) => c + 1);
          }
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${eventId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const next = payload?.new;
          const prev = payload?.old;
          if (!next) return;
          if (next.status === "scanned" && prev?.status !== "scanned") {
            const ts = next.checked_in_at
              ? new Date(next.checked_in_at).getTime()
              : Date.now();
            const now = Date.now();
            const bi = bucketIndexFor(ts, now);
            if (bi >= 0) {
              setBuckets((prevBuckets) => {
                const nextBuckets = prevBuckets.slice();
                nextBuckets[bi] += 1;
                return nextBuckets;
              });
            }
            setScannedCount((c) => c + 1);
            setRecent((prevFeed) =>
              [
                {
                  id: next.id,
                  checked_in_at:
                    next.checked_in_at || new Date().toISOString(),
                  qr_token: next.qr_token,
                },
                ...prevFeed,
              ].slice(0, 20),
            );
          } else if (
            next.status === "refunded" &&
            prev?.status !== "refunded"
          ) {
            setRefunded((c) => c + 1);
            setSold((c) => Math.max(0, c - 1));
          }
        },
      )
      .subscribe((status: string) => {
        setConnected(status === "SUBSCRIBED");
      });
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [
    hasAccess,
    eventId,
    setSold,
    setScannedCount,
    setRefunded,
    setRecent,
    setBuckets,
    setConnected,
  ]);

  // ── Slow polling fallback to keep counts honest if Realtime drops ─────
  useEffect(() => {
    if (!hasAccess) return;
    const id = setInterval(() => {
      refreshCounts();
    }, 30_000);
    return () => clearInterval(id);
  }, [hasAccess, refreshCounts]);

  // ── Slide buckets every 60s so the chart x-axis stays "last 30 min" ───
  useEffect(() => {
    if (!hasAccess) return;
    const id = setInterval(() => {
      setBuckets((prev) => {
        const next = prev.slice(1);
        next.push(0);
        return next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [hasAccess, setBuckets]);

  // ── Derived ───────────────────────────────────────────────────────────
  const scanRate = useMemo(() => {
    if (sold <= 0) return null;
    return Math.round((scannedCount / sold) * 100);
  }, [sold, scannedCount]);

  const last5m = useMemo(
    () => buckets.slice(-5).reduce((s, n) => s + n, 0),
    [buckets],
  );

  const maxBucket = useMemo(() => Math.max(1, ...buckets), [buckets]);

  // ── Feed virtualizer (TanStack Virtual) ───────────────────────────────
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const feedVirtualizer = useVirtualizer({
    count: recent.length,
    getScrollElement: () => feedScrollRef.current,
    estimateSize: () => FEED_ROW_HEIGHT,
    overscan: 8,
  });

  // ── Header ─────────────────────────────────────────────────────────────
  const Header = (
    <div
      className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 active:scale-95"
      >
        <ArrowLeft size={18} color="#fff" />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-semibold leading-tight tracking-tight">
          {eventTitle || "Live"}
        </h1>
        <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-[#FB7185] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: connected ? "#22C55E" : "#F59E0B" }}
          />
          {connected ? "Live · realtime" : "Live · reconnecting"}
        </span>
      </div>
      <Radio size={20} color={connected ? "#22C55E" : "#F59E0B"} />
    </div>
  );

  // ── Permission denied state ───────────────────────────────────────────
  if (permissionDenied) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        {Header}
        <div className="flex flex-col items-center justify-center gap-2.5 px-10 py-24 text-center">
          <Radio size={36} color="rgba(255,255,255,0.4)" />
          <p className="mt-1.5 text-lg font-bold text-white">
            War room locked
          </p>
          <p className="text-[13px] leading-5 text-white/60">
            You need owner, admin, editor, or scanner access to view this
            event&apos;s live operations.
          </p>
          <button
            onClick={() => router.back()}
            className="mt-3.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white active:bg-white/5"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        {Header}
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
          <p className="mt-4 text-sm text-white/40">Tuning into the room…</p>
        </div>
      </div>
    );
  }

  const feedItems = feedVirtualizer.getVirtualItems();

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {Header}

      <main className="mx-auto w-full max-w-2xl px-4 pb-12">
        {/* ── Hero stats: Sold / Scanned / Scan rate ── */}
        <div className="mt-4 flex gap-2">
          <StatTile label="Sold" value={String(sold)} accent="#3FDCFF" />
          <StatTile
            label="Scanned"
            value={String(scannedCount)}
            accent="#22C55E"
          />
          <StatTile
            label="Scan rate"
            value={scanRate != null ? `${scanRate}%` : "—"}
            accent="#FF5BFC"
          />
        </div>

        {/* ── Last-5-min hero card ── */}
        <section className="mt-4 flex items-center gap-4 rounded-2xl border border-[#22c55e]/25 bg-[#22c55e]/10 p-[18px]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-wide text-[#22c55e]/85">
              SCANS · LAST 5 MIN
            </p>
            <p className="mt-0.5 text-[44px] font-extrabold leading-none tracking-tighter text-white">
              {last5m}
            </p>
            <p className="mt-1 text-xs text-white/45">
              {refunded > 0
                ? `${refunded} refunded`
                : "Tap Attendees for actions"}
            </p>
          </div>
          <ScanLine size={36} color="rgba(34,197,94,0.5)" />
        </section>

        {/* ── Scans-per-minute bar chart (raw CSS bars, no chart lib) ── */}
        <p className="px-1 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wide text-white/45">
          Scans per minute · last 30m
        </p>
        <div className="flex h-20 items-end gap-0.5">
          {buckets.map((b, i) => {
            const h = Math.max(2, (b / maxBucket) * 70);
            const isNow = i === buckets.length - 1;
            return (
              <div
                key={i}
                className="flex-1 rounded-[3px]"
                style={{
                  height: `${h}px`,
                  minHeight: 2,
                  backgroundColor: isNow
                    ? "#22C55E"
                    : b > 0
                      ? "rgba(34,197,94,0.55)"
                      : "rgba(255,255,255,0.06)",
                }}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between px-0.5 pt-1">
          <span className="text-[10px] text-white/35">30m ago</span>
          <span className="text-[10px] text-white/35">now</span>
        </div>

        {/* ── Recent check-ins feed (TanStack Virtual) ── */}
        <p className="px-1 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wide text-white/45">
          Recent check-ins
        </p>
        {recent.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-white/40">No scans yet.</p>
        ) : (
          <div
            ref={feedScrollRef}
            className="overflow-y-auto rounded-2xl border border-white/8 bg-white/[0.02]"
            style={{ maxHeight: "calc(100dvh - 420px)", minHeight: 120 }}
          >
            <div
              className="relative w-full"
              style={{ height: feedVirtualizer.getTotalSize() }}
            >
              {feedItems.map((vItem) => {
                const r = recent[vItem.index];
                if (!r) return null;
                return (
                  <div
                    key={r.id}
                    data-index={vItem.index}
                    className="absolute left-0 top-0 flex w-full items-center gap-3 border-b border-white/[0.06] px-4"
                    style={{
                      height: FEED_ROW_HEIGHT,
                      transform: `translateY(${vItem.start}px)`,
                    }}
                  >
                    {/* rounded-square scan marker (never circular) */}
                    <span className="h-2 w-2 shrink-0 rounded-[3px] bg-[#22C55E]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {r.ticket_type_name || "Ticket"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/35">
                        {r.qr_token ? r.qr_token.slice(0, 8) : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-white/55">
                      {formatClock(r.checked_in_at)}
                    </span>
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

export default EventLiveScreen;
