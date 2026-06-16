/**
 * Tier-accent color tokens. The four tier colors are deliberate brand
 * accents — replace raw hex literals (`#34A2DF`, `#FF5BFC`, etc.) with
 * `tierAccent(tier)` so the brand stays consistent and a future palette
 * shift only touches this file + global.css.
 *
 * Canonical mapping (verified against src/ticket/ui/TicketQRCode.tsx):
 *   free  → #3FDCFF cyan-bright  → --accent-cyan
 *   ga    → #34A2DF cyan-blue    ≈ --primary
 *   vip   → #8A40CF deep purple  ≈ --purple
 *   table → #FF5BFC magenta      ≈ --accent
 *
 * Soft variants used for highlights/glows/sub-elements where the
 * canonical tier color would dominate too much:
 *   vip-soft → #C084FC violet   → --accent-vip-soft
 */

import type { TicketTierLevel } from "@/lib/stores/ticket-store";

/** Raw hex values. Use only when an SDK requires a string literal
 *  (Stripe PaymentSheet appearance, native Status Bar tint, etc.). For
 *  Tailwind / React-Native styles prefer the semantic tokens via
 *  className="text-primary" / className="bg-accent". */
export const tierHex: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

/** Soft variant for halo/glow/secondary chips. Currently only VIP has a
 *  defined soft variant; others fall through to the canonical color. */
export const tierHexSoft: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#C084FC",
  table: "#FF5BFC",
};

/** Resolve the canonical brand hex for a tier. Convenience wrapper so
 *  callers don't have to import the record directly. */
export function tierAccent(tier: TicketTierLevel | null | undefined): string {
  if (!tier) return tierHex.ga;
  return tierHex[tier] ?? tierHex.ga;
}

/** Resolve the soft/highlight variant for a tier. */
export function tierAccentSoft(
  tier: TicketTierLevel | null | undefined,
): string {
  if (!tier) return tierHexSoft.ga;
  return tierHexSoft[tier] ?? tierHexSoft.ga;
}
