"use client";

/**
 * TierBadge — WEB variant. Same mark, same rules, CSS instead of Skia.
 *
 * Native mills the metal with a Skia runtime effect; the browser gets the same
 * three stops (shadow → body → highlight) as a 135° `linear-gradient` with the
 * specular band held at the same 0.42 position the native shader parks it at,
 * plus the lit top / dark bottom edge as an inset box-shadow. Identical colours
 * from `tierIdentity`, so a tier looks the same in both apps.
 *
 * The rules the native file sets are load-bearing and kept exactly:
 *  - This is NOT a verification check. It sits BESIDE `users.verified`, never
 *    replaces it, and never borrows the checkmark shape.
 *  - Free / unknown renders NOTHING. There is no badge for not subscribing.
 *  - `showLabel` is owner-only: you may read your own tier name, not someone
 *    else's.
 *
 * ponytail: static sweep, no animation. The native `animated` prop drives a
 * per-frame Skia clock for the checkout award moment, which has no web caller
 * yet — the prop is accepted and ignored rather than growing a rAF loop for a
 * badge that sits beside a username.
 */

import type { PlanKey } from "@dvnt/app/lib/subscription/types";
import { tierIdentity } from "@dvnt/app/lib/theme/membership-tier";

export function TierBadge({
  plan,
  size = 16,
  showLabel = false,
}: {
  plan: PlanKey | null | undefined;
  size?: number;
  /** Accepted for signature parity with native; the web mark is static. */
  animated?: boolean;
  /** Tier name beside the mark. Owner-only surfaces. */
  showLabel?: boolean;
}) {
  const identity = tierIdentity(plan);
  if (!identity) return null;

  const { shadow, body, highlight } = identity.metal;
  const w = size * 1.15;

  const mark = (
    <span
      role="img"
      aria-label={`${identity.label} member`}
      title={`${identity.label} member`}
      className="inline-block shrink-0 align-middle"
      style={{
        width: w,
        height: size,
        borderRadius: size / 4,
        // 42% is where the native shader parks `u_sweep`; the narrow highlight
        // stop either side of it is the specular band, not a soft gradient.
        background: `linear-gradient(135deg, ${shadow} 0%, ${body} 30%, ${highlight} 42%, ${body} 56%, ${shadow} 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.28)`,
      }}
    />
  );

  if (!showLabel) return mark;

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {mark}
      <span
        style={{
          color: identity.flat,
          fontSize: Math.max(11, size * 0.72),
          fontWeight: 700,
          letterSpacing: "0.3px",
        }}
      >
        {identity.label}
      </span>
    </span>
  );
}
