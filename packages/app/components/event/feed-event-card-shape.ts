import { EVENT_FLYER_ASPECT } from "../../lib/events/flyer-layout.ts";

/** Feed flyers use the same uncropped portrait canvas as the event page. */
export const CARD_ASPECT = EVENT_FLYER_ASPECT;
/** Keep portrait flyers readable without becoming tablet-sized posters. */
export const CARD_MAX_WIDTH = 384;
/** Separate details from the artwork; also reserved by the web masonry packer. */
export const CARD_DETAILS_HEIGHT = 200;
export const CARD_HORIZONTAL_PADDING = 4;
export const CARD_VERTICAL_PADDING = 12;

/** Exact rendered extent, including the outer padding and the details panel. */
export function feedEventCardHeight(width: number): number {
  const mediaWidth = Math.max(0, Math.min(width, CARD_MAX_WIDTH) - CARD_HORIZONTAL_PADDING * 2);
  return mediaWidth / CARD_ASPECT + CARD_DETAILS_HEIGHT + CARD_VERTICAL_PADDING * 2;
}

/**
 * Shape of the event cards on the Events screen and the public events tab.
 *
 * 6:4 (3:2) — width/height, so `height = width / EVENT_CARD_ASPECT`.
 *
 * These cards size off the width they are given, so the ratio is what makes
 * the height responsive. It was 4:5 portrait (height = width x 1.25), which is
 * how the flyer is authored — fine at a phone's ~378pt, but once the card grew
 * to the full 768pt content column that same ratio made it 960pt tall, taller
 * than the screen showing it. 6:5 keeps the card in view at any width.
 */
export const EVENT_CARD_ASPECT = 6 / 4;
