"use client";

import { Check } from "lucide-react";
import { color } from "@dvnt/app/lib/theme";

/**
 * Web port of `../deviant/src/events/ui/TicketTierCard.tsx` — the existing
 * selectable tier card. Faithful: 200px card, glow border/bg on select, Check
 * badge, tier badge + category label, name, big price + original-price
 * strikethrough, up to 3 perks, "SOLD OUT" / "Only N left" / "N available"
 * footer. Live current price (cents → display) is resolved by the caller via the
 * shared pricing module so the Posh price-up shows through `originalPrice`.
 */
export interface TierCardData {
  id: string;
  tier: string; // ga / vip / early_bird / table_service / ...
  category?: string; // admission / product / service
  name: string;
  /** Display price in dollars (caller resolves cents → current price). */
  price: number;
  originalPrice?: number | null;
  perks?: string[];
  remaining: number;
  isSoldOut?: boolean;
  /** Tier glow hex. */
  glowColor: string;
}

const TIER_CATEGORY: Record<string, string> = { admission: "Admission", product: "Product", service: "Service" };

export function TicketTierCard({ tier, isSelected, onSelect }: { tier: TierCardData; isSelected: boolean; onSelect: (t: TierCardData) => void }) {
  const isVip = tier.tier === "vip" || tier.tier === "table_service" || tier.tier === "table";
  const categoryLabel = TIER_CATEGORY[tier.category ?? "admission"] ?? "Admission";
  const g = tier.glowColor;

  return (
    <button
      onClick={() => !tier.isSoldOut && onSelect(tier)}
      disabled={tier.isSoldOut}
      style={{
        position: "relative",
        width: 200,
        minHeight: 190,
        flex: "0 0 auto",
        textAlign: "left",
        borderRadius: 20,
        padding: 16,
        marginRight: 12,
        cursor: tier.isSoldOut ? "default" : "pointer",
        border: `${isSelected ? 2.5 : 1}px solid ${isSelected ? g : color.hairline}`,
        background: isSelected ? `${g}26` : color.surface,
        opacity: tier.isSoldOut ? 0.5 : 1,
        boxShadow: isSelected ? `0 0 14px ${g}59` : "none",
        transform: isSelected ? "scale(1.025)" : "scale(1)",
        transition: "transform 220ms cubic-bezier(0.33,1,0.68,1), box-shadow 220ms",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {isSelected ? (
        <span style={{ position: "absolute", top: 12, right: 12, width: 22, height: 22, borderRadius: 11, background: g, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check size={12} color="#000" strokeWidth={3} />
        </span>
      ) : null}

      <span style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ borderRadius: 8, padding: "3px 8px", background: `${g}25` }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: g }}>{tier.tier.toUpperCase()}</span>
        </span>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 500, letterSpacing: "0.03em" }}>{categoryLabel}</span>
      </span>

      <span style={{ display: "block", color: "#fff", fontSize: 17, fontWeight: 700, marginBottom: 6, fontFamily: "SpaceGrotesk, system-ui, sans-serif" }}>{tier.name}</span>

      <span style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 12 }}>
        <span style={{ color: isVip ? g : "#fff", fontSize: 26, fontWeight: 800, fontFamily: "SpaceMono, ui-monospace, monospace" }}>
          {tier.price === 0 ? "FREE" : `$${tier.price}`}
        </span>
        {tier.originalPrice != null && tier.originalPrice > tier.price ? (
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 14, textDecoration: "line-through", fontFamily: "SpaceMono, ui-monospace, monospace" }}>${tier.originalPrice}</span>
        ) : null}
      </span>

      {tier.perks && tier.perks.length > 0 ? (
        <span style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
          {tier.perks.slice(0, 3).map((perk, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>✓</span>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{perk}</span>
            </span>
          ))}
        </span>
      ) : null}

      <span style={{ marginTop: "auto" }}>
        {tier.isSoldOut ? (
          <span style={{ color: color.signal, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em" }}>SOLD OUT</span>
        ) : tier.remaining <= 10 ? (
          <span style={{ color: color.magenta, fontSize: 12, fontWeight: 600 }}>Only {tier.remaining} left</span>
        ) : (
          <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{tier.remaining} available</span>
        )}
      </span>
    </button>
  );
}
