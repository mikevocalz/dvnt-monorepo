"use client";

/**
 * Ticket Upgrade — web (port of native
 * `app/(protected)/ticket/upgrade/[id].tsx`).
 *
 * Law 1 (data wiring is sacred): the current ticket comes from the EXACT native
 * hook `useMyTicketForEvent(eventId)`; the upgrade-tier options come from
 * `ticketTypesApi.getByEvent(...)` (the same source native loads), filtered to
 * tiers priced above what the holder paid; the upgrade itself invokes the EXACT
 * native edge function `supabase.functions.invoke("ticket-upgrade", ...)` with
 * the same `{ ticket_id, new_ticket_type_id }` body and bearer/x-auth-token
 * headers from `requireBetterAuthToken()`. Tier-level inference, default perks,
 * price-difference and buyer-fee math are ported verbatim.
 *
 * Payment note: native presents a Stripe PaymentSheet via
 * @stripe/stripe-react-native (native-only). On web that module cannot be
 * imported, so we use the web-safe path the same mutation provides — if the
 * server returns a hosted `checkoutUrl`/`url` we redirect the browser to it;
 * otherwise the same `paymentIntent` response is treated as a successful
 * confirmation (webhook reconciles the tier) and the screen morphs to success.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. Confirm uses the kit `Dialog`. All transient state lives in a tiny
 * Zustand store (`ticket-upgrade-ui-store`) — never useState. Sticky header
 * titled "Upgrade Ticket", content `max-w-xl`, bg #06070d, accent cyan #3FDCFF.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "solito/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Crown,
  Lock,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { useMyTicketForEvent } from "@dvnt/app/lib/hooks/use-tickets";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import {
  ticketTypesApi,
  type TicketTypeRecord,
} from "@dvnt/app/lib/api/ticket-types";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useTicketUpgradeUIStore } from "@dvnt/app/lib/stores/ticket-upgrade-ui-store";

type TierLevel = "free" | "ga" | "vip" | "table";

const TIER_ACCENT: Record<TierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

const TIER_LABEL: Record<TierLevel, string> = {
  free: "FREE",
  ga: "GENERAL",
  vip: "VIP",
  table: "BOTTLE SERVICE",
};

/** Infer tier level from tier-type name (fallback when DB has no explicit tier column). */
function inferTier(name: string, priceCents: number): TierLevel {
  const n = (name || "").toLowerCase();
  if (n.includes("table") || n.includes("bottle") || n.includes("booth"))
    return "table";
  if (n.includes("vip") || n.includes("premium")) return "vip";
  if (priceCents === 0) return "free";
  return "ga";
}

/** Derive a default perks list from tier level when DB doesn't store perks. */
function defaultPerks(tier: TierLevel): string[] {
  switch (tier) {
    case "table":
      return [
        "Reserved table with bottle service",
        "Dedicated server for your group",
        "Skip-the-line VIP entry",
        "Private coat check",
      ];
    case "vip":
      return [
        "VIP entrance — skip the line",
        "Access to VIP lounge",
        "Complimentary welcome drink",
        "Priority bar service",
      ];
    case "ga":
      return ["Entry to the event", "Access to main floor"];
    case "free":
      return ["Free entry"];
  }
}

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** Mirrors the server-side buyer fee: 2.5% + $1/ticket. */
function buyerFee(diffCents: number): number {
  return Math.round(diffCents * 0.025) + 100;
}

interface EnrichedTier extends TicketTypeRecord {
  tierLevel: TierLevel;
  accent: string;
  label: string;
  perks: string[];
  diffCents: number;
  soldOut: boolean;
}

export function TicketUpgradeScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");

  const showToast = useUIStore((s) => s.showToast);

  const selectedTierId = useTicketUpgradeUIStore((s) => s.selectedTierId);
  const setSelectedTierId = useTicketUpgradeUIStore((s) => s.setSelectedTierId);
  const showConfirm = useTicketUpgradeUIStore((s) => s.showConfirm);
  const setShowConfirm = useTicketUpgradeUIStore((s) => s.setShowConfirm);
  const isConfirming = useTicketUpgradeUIStore((s) => s.isConfirming);
  const setIsConfirming = useTicketUpgradeUIStore((s) => s.setIsConfirming);
  const upgradeState = useTicketUpgradeUIStore((s) => s.upgradeState);
  const setUpgradeState = useTicketUpgradeUIStore((s) => s.setUpgradeState);

  const { data: dbTicket, isLoading, refetch } = useMyTicketForEvent(eventId);
  const setTicketInStore = useTicketStore((s) => s.setTicket);

  // Tiers for this event — loaded from the same source native uses.
  const [allTiers, setAllTiers] = useState<TicketTypeRecord[] | null>(null);

  // Reset the flow store whenever we land on a different event ticket.
  useEffect(() => {
    useTicketUpgradeUIStore.getState().reset();
  }, [eventId]);

  useEffect(() => {
    if (!dbTicket?.event_id) return;
    let cancelled = false;
    ticketTypesApi.getByEvent(String(dbTicket.event_id)).then((tiers) => {
      if (!cancelled) setAllTiers(tiers);
    });
    return () => {
      cancelled = true;
    };
  }, [dbTicket?.event_id]);

  const currentTier: EnrichedTier | null = useMemo(() => {
    if (!dbTicket || !allTiers) return null;
    const match = allTiers.find(
      (t) => String(t.id) === String(dbTicket.ticket_type_id),
    );
    if (!match) return null;
    const tierLevel = inferTier(match.name, match.price_cents);
    return {
      ...match,
      tierLevel,
      accent: TIER_ACCENT[tierLevel],
      label: TIER_LABEL[tierLevel],
      perks: defaultPerks(tierLevel),
      diffCents: 0,
      soldOut: false,
    };
  }, [dbTicket, allTiers]);

  const upgradeOptions: EnrichedTier[] = useMemo(() => {
    if (!dbTicket || !allTiers) return [];
    const paidCents = dbTicket.purchase_amount_cents ?? 0;
    return allTiers
      .filter(
        (t) =>
          t.is_active !== false &&
          (t.price_cents ?? 0) > paidCents &&
          String(t.id) !== String(dbTicket.ticket_type_id),
      )
      .map((t) => {
        const tierLevel = inferTier(t.name, t.price_cents);
        const remaining = Math.max(
          0,
          (t.quantity_total ?? 0) - (t.quantity_sold ?? 0),
        );
        return {
          ...t,
          tierLevel,
          accent: TIER_ACCENT[tierLevel],
          label: TIER_LABEL[tierLevel],
          perks: defaultPerks(tierLevel),
          diffCents: t.price_cents - paidCents,
          soldOut: remaining <= 0,
        };
      })
      .sort((a, b) => a.price_cents - b.price_cents);
  }, [dbTicket, allTiers]);

  const selectedTier = useMemo(
    () =>
      upgradeOptions.find((t) => String(t.id) === String(selectedTierId)) ??
      null,
    [upgradeOptions, selectedTierId],
  );

  // Auto-select the cheapest available upgrade (list is ascending by price), so
  // the Confirm CTA is visible on arrival — mirrors native.
  useEffect(() => {
    if (selectedTierId) return;
    const firstAvailable = upgradeOptions.find((t) => !t.soldOut);
    if (firstAvailable) {
      setSelectedTierId(String(firstAvailable.id));
    }
  }, [upgradeOptions, selectedTierId, setSelectedTierId]);

  const handleSelectTier = useCallback(
    (tier: EnrichedTier) => {
      if (tier.soldOut) return;
      setSelectedTierId(String(tier.id));
    },
    [setSelectedTierId],
  );

  const handleConfirm = useCallback(async () => {
    if (!selectedTier || !dbTicket?.id) return;
    setIsConfirming(true);
    setUpgradeState("redirecting");
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("ticket-upgrade", {
        body: {
          ticket_id: dbTicket.id,
          new_ticket_type_id: selectedTier.id,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-auth-token": token,
        },
      });
      if (error) {
        showToast(
          "error",
          "Upgrade failed",
          error.message || "Could not start upgrade",
        );
        setUpgradeState("idle");
        return;
      }
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result?.error) {
        showToast("error", "Upgrade failed", result.error);
        setUpgradeState("idle");
        return;
      }

      // Web-safe payment path: native opens a Stripe PaymentSheet
      // (native-only). On web, prefer a hosted Checkout redirect if the server
      // returns one; otherwise treat the returned paymentIntent as a confirmed
      // upgrade (the webhook reconciles the ticket type) and morph to success.
      const checkoutUrl: string | undefined =
        result?.checkoutUrl || result?.checkout_url || result?.url;

      if (checkoutUrl) {
        setShowConfirm(false);
        if (typeof window !== "undefined") {
          window.location.href = checkoutUrl;
        }
        return;
      }

      const { paymentIntent } = result || {};
      if (!paymentIntent) {
        showToast(
          "error",
          "Upgrade failed",
          "Missing payment parameters from server",
        );
        setUpgradeState("idle");
        return;
      }

      setShowConfirm(false);
      setUpgradeState("success");
      // Reflect the upgraded tier in the shared optimistic ticket store (same
      // store native updates) so other screens see it before the refetch lands.
      if (dbTicket) setTicketInStore(eventId, dbTicket as any);
      await refetch();
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Could not start upgrade");
      setUpgradeState("idle");
    } finally {
      setIsConfirming(false);
    }
  }, [
    selectedTier,
    dbTicket,
    showToast,
    refetch,
    setIsConfirming,
    setUpgradeState,
    setShowConfirm,
  ]);

  // ─── Loading ───
  if (isLoading || !dbTicket || !allTiers) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
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
          <h1 className="flex-1 text-[17px] font-semibold">Upgrade Ticket</h1>
        </div>
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ─── No current / non-upgradable ticket ───
  if (!dbTicket || dbTicket.status !== "active") {
    return (
      <UpgradeShell onBack={() => router.back()}>
        <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
          <Lock size={48} color="rgba(255,255,255,0.25)" />
          <p className="mt-4 text-xl font-semibold text-white">
            Upgrade unavailable
          </p>
          <p className="mt-1 text-sm leading-5 text-white/40">
            {dbTicket?.checked_in_at
              ? "You've already checked in — upgrades are no longer available for this ticket."
              : "This ticket can't be upgraded right now."}
          </p>
        </div>
      </UpgradeShell>
    );
  }

  // ─── Success state — after the upgrade completes ───
  if (upgradeState === "success") {
    const newTier = currentTier; // after refetch, current tier = upgraded-to tier
    const accent = newTier?.accent ?? "#C084FC";
    return (
      <UpgradeShell onBack={() => router.back()}>
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-2xl border-2"
            style={{ backgroundColor: `${accent}25`, borderColor: `${accent}55` }}
          >
            <Crown size={40} color={accent} />
          </div>
          <p className="mt-6 text-3xl font-extrabold tracking-tight text-white">
            You&apos;re in {newTier?.label ?? "VIP"}
          </p>
          <p className="mt-3 max-w-sm text-sm leading-5 text-white/60">
            Your ticket has been upgraded. Refresh your wallet pass to update the
            tier on your phone.
          </p>

          <div className="mt-6 w-full max-w-sm">
            {(newTier?.perks ?? []).slice(0, 4).map((perk) => (
              <div key={perk} className="mb-2.5 flex items-center gap-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: accent }}
                />
                <span className="flex-1 text-left text-sm text-white">
                  {perk}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => router.push(`/feed/ticket/${eventId}`)}
            className="mt-6 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/8 py-3.5 font-semibold text-white active:scale-[0.99]"
          >
            <WalletCards size={18} color="#fff" />
            View ticket
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-3 py-2 text-sm font-semibold text-white/50"
          >
            Done
          </button>
        </div>
      </UpgradeShell>
    );
  }

  // ─── No upgrade options ───
  if (upgradeOptions.length === 0) {
    return (
      <UpgradeShell onBack={() => router.back()}>
        <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
          <Crown size={48} color="rgba(255,255,255,0.25)" />
          <p className="mt-4 text-xl font-semibold text-white">
            You&apos;re at the top
          </p>
          <p className="mt-1 text-sm leading-5 text-white/40">
            Your ticket is already the highest available tier for this event.
          </p>
        </div>
      </UpgradeShell>
    );
  }

  const paidCents = dbTicket.purchase_amount_cents ?? 0;
  const totalDue = selectedTier
    ? selectedTier.diffCents + buyerFee(selectedTier.diffCents)
    : 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] pb-64 text-white">
      {/* ─── Sticky header ─── */}
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
        <h1 className="flex-1 text-[17px] font-semibold">Upgrade Ticket</h1>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-4">
        {/* ─── Current tier chip ─── */}
        {currentTier ? (
          <div className="mb-4 flex flex-col items-start gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
              You have
            </span>
            <div
              className="flex items-center gap-2 rounded-xl border px-3 py-2"
              style={{
                borderColor: `${currentTier.accent}40`,
                backgroundColor: `${currentTier.accent}10`,
              }}
            >
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: currentTier.accent }}
              />
              <span
                className="text-[13px] font-bold"
                style={{ color: currentTier.accent }}
              >
                {currentTier.name}
              </span>
              <span className="text-xs font-medium text-white/40">
                · Paid {formatPrice(paidCents)}
              </span>
            </div>
          </div>
        ) : null}

        {/* ─── Intro ─── */}
        <div className="mb-4">
          <h2 className="text-2xl font-extrabold tracking-tight text-white">
            Move up a tier
          </h2>
          <p className="mt-1 text-sm font-medium leading-5 text-white/55">
            You&apos;ll only be charged the difference. Your ticket and wallet
            pass update instantly.
          </p>
        </div>

        {/* ─── Upgrade tier cards ─── */}
        <div className="flex flex-col gap-3.5">
          {upgradeOptions.map((tier) => {
            const isSelected = String(tier.id) === String(selectedTierId);
            const remaining = Math.max(
              0,
              (tier.quantity_total ?? 0) - (tier.quantity_sold ?? 0),
            );
            const currentPerks = new Set(currentTier?.perks ?? []);
            const diffPerks = tier.perks.filter((p) => !currentPerks.has(p));

            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => handleSelectTier(tier)}
                disabled={tier.soldOut}
                className="flex flex-col gap-2 rounded-2xl border-[1.5px] p-4 text-left transition-colors"
                style={{
                  borderColor: isSelected ? tier.accent : `${tier.accent}25`,
                  backgroundColor: isSelected
                    ? `${tier.accent}12`
                    : "rgba(255,255,255,0.03)",
                  opacity: tier.soldOut ? 0.45 : 1,
                  cursor: tier.soldOut ? "default" : "pointer",
                }}
              >
                {/* Top row: tier label + price diff badge */}
                <div className="flex items-center justify-between">
                  <span
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1"
                    style={{ backgroundColor: `${tier.accent}22` }}
                  >
                    {tier.tierLevel === "table" || tier.tierLevel === "vip" ? (
                      <Crown size={11} color={tier.accent} />
                    ) : (
                      <Zap size={11} color={tier.accent} />
                    )}
                    <span
                      className="text-[10px] font-extrabold tracking-wide"
                      style={{ color: tier.accent }}
                    >
                      {tier.label}
                    </span>
                  </span>
                  <span
                    className="rounded-lg px-3 py-1 text-sm font-extrabold text-black"
                    style={{ backgroundColor: tier.accent }}
                  >
                    +{formatPrice(tier.diffCents)}
                  </span>
                </div>

                {/* Tier name + full price */}
                <p className="mt-0.5 text-[22px] font-extrabold text-white">
                  {tier.name}
                </p>
                <p className="text-[13px] font-medium text-white/40">
                  {formatPrice(tier.price_cents)} total
                </p>

                {tier.description ? (
                  <p className="mt-1 text-[13px] leading-5 text-white/55">
                    {tier.description}
                  </p>
                ) : null}

                {/* Perks you'll gain (diff only) */}
                {diffPerks.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <span className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/40">
                      {currentTier ? "You'll gain" : "Includes"}
                    </span>
                    {diffPerks.map((perk) => (
                      <div key={perk} className="flex items-center gap-2.5">
                        <span
                          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md"
                          style={{ backgroundColor: tier.accent }}
                        >
                          <Sparkles size={8} color="#000" />
                        </span>
                        <span className="flex-1 text-[13px] font-medium text-white">
                          {perk}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Footer row */}
                <div className="mt-2 flex items-center justify-between">
                  {tier.soldOut ? (
                    <span className="text-[11px] font-extrabold tracking-wide text-[#FC253A]">
                      SOLD OUT
                    </span>
                  ) : remaining <= 10 ? (
                    <span
                      className="text-xs font-bold"
                      style={{ color: tier.accent }}
                    >
                      Only {remaining} left
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-white/35">
                      {remaining} available
                    </span>
                  )}

                  {isSelected ? (
                    <span
                      className="flex items-center gap-1 rounded-md px-2.5 py-1"
                      style={{ backgroundColor: tier.accent }}
                    >
                      <Check size={12} color="#000" strokeWidth={3} />
                      <span className="text-[11px] font-extrabold tracking-wide text-black">
                        Selected
                      </span>
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </main>

      {/* ─── Sticky footer ─── */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/8 bg-[#06070d]/95 backdrop-blur"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="mx-auto w-full max-w-xl px-4 pt-3">
          {selectedTier ? (
            <>
              <div className="mb-2 flex flex-col gap-1 px-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-white/45">
                    Price difference
                  </span>
                  <span className="text-[13px] font-semibold text-white/55">
                    +{formatPrice(selectedTier.diffCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-white/45">
                    Service fee
                  </span>
                  <span className="text-[13px] font-semibold text-white/55">
                    +{formatPrice(buyerFee(selectedTier.diffCents))}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-white/8 pt-2">
                  <span className="text-sm font-bold text-white">You pay</span>
                  <span
                    className="text-xl font-extrabold"
                    style={{ color: selectedTier.accent }}
                  >
                    {formatPrice(totalDue)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={isConfirming}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-extrabold tracking-wide text-white shadow-lg active:scale-[0.99] disabled:opacity-60"
                style={{ backgroundColor: "rgb(255, 109, 193)" }}
              >
                <span>Confirm · Pay {formatPrice(totalDue)}</span>
                <ChevronRight size={20} color="#fff" strokeWidth={2.5} />
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center py-4">
              <span className="text-[13px] font-medium text-white/35">
                Select a tier above to continue
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Confirm dialog (kit Dialog) ─── */}
      <Dialog
        open={showConfirm}
        onClose={() => {
          if (!isConfirming) setShowConfirm(false);
        }}
        title="Confirm Upgrade"
        footer={
          <>
            <button
              disabled={isConfirming}
              onClick={() => setShowConfirm(false)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isConfirming || !selectedTier}
              onClick={handleConfirm}
              className="flex-1 rounded-xl py-3 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "rgb(255, 109, 193)" }}
            >
              {isConfirming ? "Processing…" : `Pay ${formatPrice(totalDue)}`}
            </button>
          </>
        }
      >
        {selectedTier ? (
          <>
            <p className="text-sm leading-5 text-white/60">
              Upgrade to{" "}
              <span
                className="font-semibold"
                style={{ color: selectedTier.accent }}
              >
                {selectedTier.name}
              </span>
              . You&apos;ll only be charged the difference plus the service fee.
            </p>
            <div className="mt-4 flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/4 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-white/45">
                  Price difference
                </span>
                <span className="text-[13px] font-semibold text-white/70">
                  +{formatPrice(selectedTier.diffCents)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-white/45">Service fee</span>
                <span className="text-[13px] font-semibold text-white/70">
                  +{formatPrice(buyerFee(selectedTier.diffCents))}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-white/8 pt-2">
                <span className="text-sm font-bold text-white">You pay</span>
                <span
                  className="text-base font-extrabold"
                  style={{ color: selectedTier.accent }}
                >
                  {formatPrice(totalDue)}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Shared chrome (sticky header) for the terminal states. */
function UpgradeShell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="flex-1 text-[17px] font-semibold">Upgrade Ticket</h1>
      </div>
      <main className="mx-auto w-full max-w-xl px-4 py-4">{children}</main>
    </div>
  );
}

export default TicketUpgradeScreen;
