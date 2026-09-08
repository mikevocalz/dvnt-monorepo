/**
 * What counts as an impression, in DVNT's terms rather than Google's.
 *
 * §13: at least half the card visible for at least one continuous second while
 * the app is foregrounded, deduplicated per placement token. It is the number
 * an organizer is shown and the number the fairness selector's deficit is
 * computed from, so a loose definition inflates both.
 *
 * "Continuous" is the load-bearing word. A card flicking past during a fast
 * scroll accumulates visible time in fragments; summing them would let a
 * scroll-happy session manufacture delivery nobody saw.
 */

export const MIN_VISIBLE_FRACTION = 0.5;
export const MIN_CONTINUOUS_MS = 1000;

export interface VisibilitySample {
  /** ms timestamp. */
  at: number;
  /** 0–1 of the card's area on screen. */
  fraction: number;
  /** False while backgrounded, in a call, or behind a modal. */
  foregrounded: boolean;
}

/**
 * The longest unbroken run during which the card was at least half visible and
 * the app was in front.
 *
 * A sample's duration is measured to the NEXT sample, so the final sample
 * contributes nothing — we do not know how long it lasted.
 */
export function longestQualifyingRunMs(
  samples: readonly VisibilitySample[],
): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const s = samples[i];
    const qualifies =
      s.foregrounded && s.fraction >= MIN_VISIBLE_FRACTION;
    if (!qualifies) {
      run = 0;
      continue;
    }
    run += Math.max(0, samples[i + 1].at - s.at);
    if (run > longest) longest = run;
  }
  return longest;
}

export function isQualifiedImpression(
  samples: readonly VisibilitySample[],
): boolean {
  return longestQualifyingRunMs(samples) >= MIN_CONTINUOUS_MS;
}

/**
 * Deduplicate by placement token.
 *
 * A token is issued once per served slot, so the same card scrolled past twice
 * is one impression. Counting it twice would both overstate what an organizer
 * bought and understate that campaign's deficit, making the selector serve it
 * less than it is owed.
 */
export function dedupeByPlacementToken(
  events: readonly { placementToken: string }[],
): string[] {
  return [...new Set(events.map((e) => e.placementToken))];
}

export interface ImpressionContext {
  /** The organizer viewing their own boost. */
  isSelfView: boolean;
  /** Preview or admin surfaces. */
  isPreview: boolean;
  /** Server-side bot classification. */
  isBot: boolean;
  /** The token was already counted — a replay. */
  alreadyCounted: boolean;
}

export type ImpressionRejection =
  | "self-view"
  | "preview"
  | "bot"
  | "replay"
  | "not-visible-long-enough";

/**
 * Whether to count this impression, and if not, why.
 *
 * Self-views and previews are excluded because an organizer refreshing their
 * own event should not spend their own delivery, and because a metric they can
 * inflate by looking at it is not a metric.
 */
export function impressionRejection(
  samples: readonly VisibilitySample[],
  context: ImpressionContext,
): ImpressionRejection | null {
  if (context.isSelfView) return "self-view";
  if (context.isPreview) return "preview";
  if (context.isBot) return "bot";
  if (context.alreadyCounted) return "replay";
  if (!isQualifiedImpression(samples)) return "not-visible-long-enough";
  return null;
}
