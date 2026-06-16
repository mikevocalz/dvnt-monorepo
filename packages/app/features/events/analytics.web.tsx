"use client";

/**
 * Event Analytics — Organizer Dashboard — WEB port of native
 * `app/(protected)/events/[id]/analytics.tsx`.
 *
 * Law 1 (data flow is sacred): consumes the EXACT same server contract as
 * native — `eventAnalyticsApi.getSummary(eventId)` via TanStack `useQuery`
 * keyed identically `["event-analytics", eventId]` (staleTime 30s). CSV export
 * reuses the same `eventAnalyticsApi.getAttendees` + `attendeesToCsv` pipeline;
 * on web the CSV is downloaded via an object URL instead of expo-sharing.
 * Money is formatted with `formatCents` from the fee-calculator.
 *
 * Law 3 (presentation): raw semantic HTML + Tailwind only (NativeWind interop
 * is off) — no <View>/<Text>. Sticky glass header ("Analytics") like
 * legal-page.web.tsx; stat cards like host-payments.web.tsx. Charts are NOT a
 * native chart lib — tier sell-through is a CSS flex bar, the revenue split is
 * an inline <svg> donut, and ticket-status is an inline <svg> stacked bar.
 * Screen-local UI state (view tab + export busy flag) lives in a tiny Zustand
 * store, never useState. Navigation via Solito; id via useParams. bg #06070d,
 * accent cyan #3FDCFF, content max-w-2xl. No pill shapes.
 */

import { useCallback } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  DollarSign,
  Ticket,
  CheckCircle2,
  TrendingUp,
  Tag,
  AlertCircle,
  Download,
} from "lucide-react";
import {
  eventAnalyticsApi,
  attendeesToCsv,
  type EventAnalyticsSummary,
} from "@dvnt/app/lib/api/event-analytics";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useEventAnalyticsStore } from "@dvnt/app/lib/stores/event-analytics-store";

function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

function StatCard({
  icon,
  iconColor,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-white/10 bg-white/4 p-4">
      <div
        className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${iconColor}22` }}
      >
        {icon}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-extrabold text-white">{value}</p>
      {sublabel ? (
        <p className="text-xs font-medium text-white/60">{sublabel}</p>
      ) : null}
    </div>
  );
}

// CSS bar chart — tier sell-through rendered as a flex div with width %.
function ProgressBar({ percent, color }: { percent: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}

// SVG donut chart — gross / fees / refunds revenue split. No chart lib.
function RevenueDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="14"
        />
        {total > 0
          ? segments.map((seg) => {
              const frac = Math.max(0, seg.value) / total;
              const dash = frac * c;
              const el = (
                <circle
                  key={seg.label}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="14"
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              );
              offset += dash;
              return el;
            })
          : null}
      </svg>
      <div className="flex flex-col gap-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-xs text-white/60">{seg.label}</span>
            <span className="text-xs font-semibold text-white">
              {formatCents(seg.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// SVG stacked bar — ticket status distribution. No chart lib.
function StatusBar({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  let x = 0;
  const W = 320;
  return (
    <div>
      <svg
        width="100%"
        height="20"
        viewBox={`0 0 ${W} 20`}
        preserveAspectRatio="none"
        className="w-full"
      >
        <rect x="0" y="0" width={W} height="20" rx="6" fill="rgba(255,255,255,0.06)" />
        {total > 0
          ? segments.map((seg) => {
              const w = (Math.max(0, seg.value) / total) * W;
              const el = (
                <rect
                  key={seg.label}
                  x={x}
                  y="0"
                  width={Math.max(0, w)}
                  height="20"
                  fill={seg.color}
                />
              );
              x += w;
              return el;
            })
          : null}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-xs text-white/60">{seg.label}</span>
            <span className="text-xs font-semibold text-white">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventAnalyticsScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");

  const tab = useEventAnalyticsStore((s) => s.tab);
  const setTab = useEventAnalyticsStore((s) => s.setTab);
  const isExporting = useEventAnalyticsStore((s) => s.isExporting);
  const setExporting = useEventAnalyticsStore((s) => s.setExporting);

  const { data, isLoading, isError, refetch, isRefetching } =
    useQuery<EventAnalyticsSummary | null>({
      queryKey: ["event-analytics", eventId],
      queryFn: () => eventAnalyticsApi.getSummary(eventId),
      enabled: !!eventId,
      staleTime: 30 * 1000,
    });

  const handleExportAttendees = useCallback(async () => {
    if (!eventId || isExporting) return;
    setExporting(true);
    try {
      const result = await eventAnalyticsApi.getAttendees(eventId);
      if (!result || result.attendees.length === 0) {
        if (typeof window !== "undefined") {
          window.alert("No attendees yet. Once tickets are sold, you can export the list here.");
        }
        return;
      }
      const csv = attendeesToCsv(result.attendees);
      const safeTitle = (result.title || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const filename = `${safeTitle || "event"}-attendees-${eventId}.csv`;
      if (typeof window !== "undefined") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[EventAnalytics] export error:", err);
      if (typeof window !== "undefined") {
        window.alert("Couldn't generate the attendee CSV. Try again.");
      }
    } finally {
      setExporting(false);
    }
  }, [eventId, isExporting, setExporting]);

  const Header = (
    <div
      className="sticky top-0 z-20 flex items-center gap-4 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      <button
        onClick={() => router.back()}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
      >
        <ArrowLeft size={18} color="#fff" />
      </button>
      <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold">
        {data?.title || "Analytics"}
      </h1>
      <button
        onClick={handleExportAttendees}
        disabled={isExporting}
        aria-label="Export attendees as CSV"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95 disabled:opacity-40"
      >
        <Download size={18} color="#fff" />
      </button>
    </div>
  );

  if (isLoading && !data) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        {Header}
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
          <p className="mt-4 text-sm text-white/60">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        {Header}
        <div className="flex flex-col items-center justify-center gap-2.5 px-10 py-24 text-center">
          <AlertCircle size={40} color="rgba(255,255,255,0.4)" />
          <p className="mt-1.5 text-lg font-bold text-white">
            Analytics unavailable
          </p>
          <p className="text-[13px] leading-5 text-white/60">
            We couldn't load this event's numbers.
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white active:bg-white/5"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { revenue, ticketStats, tiers, promoCodes } = data;
  const checkInPercent =
    ticketStats.total > 0
      ? (ticketStats.checkedIn / ticketStats.total) * 100
      : 0;
  const remainingTickets = tiers.reduce((sum, t) => sum + t.remaining, 0);
  const totalCapacity = tiers.reduce((sum, t) => sum + t.quantityTotal, 0);
  const feesTotal = revenue.dvntFeeCents + revenue.stripeFeeCents;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {Header}

      <main className="mx-auto w-full max-w-2xl px-4 pb-12">
        {/* ── Top-line stats ── */}
        <div className="mt-4 flex gap-3">
          <StatCard
            icon={<DollarSign size={16} color="#22c55e" />}
            iconColor="#22c55e"
            label="Net revenue"
            value={formatCents(revenue.netCents)}
            sublabel={`Gross ${formatCents(revenue.grossCents)}`}
          />
          <StatCard
            icon={<Ticket size={16} color="#3b82f6" />}
            iconColor="#3b82f6"
            label="Tickets sold"
            value={String(ticketStats.total)}
            sublabel={
              totalCapacity > 0 ? `${remainingTickets} remaining` : undefined
            }
          />
        </div>
        <div className="mt-3 flex gap-3">
          <StatCard
            icon={<CheckCircle2 size={16} color="#8A40CF" />}
            iconColor="#8A40CF"
            label="Checked in"
            value={`${ticketStats.checkedIn} / ${ticketStats.total}`}
            sublabel={formatPercent(checkInPercent)}
          />
          <StatCard
            icon={<TrendingUp size={16} color="#f59e0b" />}
            iconColor="#f59e0b"
            label="Fees paid"
            value={formatCents(feesTotal)}
            sublabel={`${formatCents(revenue.dvntFeeCents)} DVNT · ${formatCents(revenue.stripeFeeCents)} Stripe`}
          />
        </div>

        {/* ── Revenue split (SVG donut chart) ── */}
        <section className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
          <p className="mb-3 text-sm font-bold tracking-wide text-white">
            Revenue split
          </p>
          <RevenueDonut
            segments={[
              { label: "Net", value: revenue.netCents, color: "#22C55E" },
              { label: "DVNT fee", value: revenue.dvntFeeCents, color: "#f59e0b" },
              { label: "Stripe fee", value: revenue.stripeFeeCents, color: "#3FDCFF" },
              { label: "Refunds", value: revenue.refundsCents, color: "#ef4444" },
            ]}
          />
        </section>

        {/* ── View tab toggle (zustand) — no pill shapes ── */}
        <div className="mt-4 flex gap-2 border-b border-white/8">
          <button
            onClick={() => setTab("overview")}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${
              tab === "overview"
                ? "border-[#3FDCFF] text-white"
                : "border-transparent text-white/50"
            }`}
          >
            Status
          </button>
          <button
            onClick={() => setTab("tiers")}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${
              tab === "tiers"
                ? "border-[#3FDCFF] text-white"
                : "border-transparent text-white/50"
            }`}
          >
            Tier performance
          </button>
        </div>

        {tab === "overview" ? (
          /* ── Ticket status breakdown (SVG stacked bar) ── */
          <section className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="mb-3 text-sm font-bold tracking-wide text-white">
              Ticket status
            </p>
            <StatusBar
              segments={[
                { label: "Active", value: ticketStats.active, color: "#22c55e" },
                { label: "Checked in", value: ticketStats.checkedIn, color: "#8A40CF" },
                { label: "Refunded", value: ticketStats.refunded, color: "#ef4444" },
                { label: "Pending transfer", value: ticketStats.transferPending, color: "#f59e0b" },
                { label: "Void", value: ticketStats.void, color: "rgba(255,255,255,0.4)" },
              ]}
            />
          </section>
        ) : (
          /* ── Per-tier breakdown (CSS bar charts) ── */
          <section className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="mb-3 text-sm font-bold tracking-wide text-white">
              Tier performance
            </p>
            {tiers.length === 0 ? (
              <p className="text-[13px] text-white/60">
                No ticket tiers configured.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {tiers.map((tier) => {
                  const accent =
                    tier.percentSold >= 100
                      ? "#ef4444"
                      : tier.percentSold >= 75
                        ? "#f59e0b"
                        : "#22c55e";
                  return (
                    <div key={tier.id} className="flex flex-col gap-1.5 py-1.5">
                      <div className="flex items-center justify-between">
                        <p className="mr-3 min-w-0 flex-1 truncate text-sm font-semibold text-white">
                          {tier.name}
                        </p>
                        <p className="text-sm font-bold text-white">
                          {formatCents(tier.revenueCents)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/60">
                          {formatCents(tier.priceCents)} · {tier.quantitySold}/
                          {tier.quantityTotal} sold
                        </span>
                        <span
                          className="text-xs font-semibold"
                          style={{
                            color:
                              tier.percentSold >= 100
                                ? "#ef4444"
                                : "rgba(255,255,255,0.6)",
                          }}
                        >
                          {formatPercent(tier.percentSold)}
                        </span>
                      </div>
                      <ProgressBar percent={tier.percentSold} color={accent} />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── Promo codes ── */}
        {promoCodes.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="mb-3 text-sm font-bold tracking-wide text-white">
              Top promo codes
            </p>
            <div className="flex flex-col">
              {promoCodes.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between border-b border-white/8 py-2 last:border-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Tag size={14} color="rgba(255,255,255,0.4)" />
                    <span className="text-[13px] font-bold tracking-wide text-white">
                      {p.code}
                    </span>
                    <span className="text-xs text-white/60">
                      {p.discountType === "percent"
                        ? `${p.discountValue}% off`
                        : `${formatCents(p.discountValue)} off`}
                    </span>
                  </div>
                  <span className="text-[13px] font-bold text-white">
                    {p.usesCount}
                    {p.maxUses ? ` / ${p.maxUses}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ── Refund footer ── */}
        {revenue.refundsCents > 0 ? (
          <p className="mt-5 px-5 text-center text-[11px] text-white/60">
            {formatCents(revenue.refundsCents)} refunded to attendees.
            {revenue.calculatedAt
              ? `  ·  Updated ${new Date(revenue.calculatedAt).toLocaleString()}`
              : ""}
          </p>
        ) : null}

        {isRefetching ? (
          <p className="mt-4 text-center text-xs text-white/40">Refreshing…</p>
        ) : null}
      </main>
    </div>
  );
}

export default EventAnalyticsScreen;
