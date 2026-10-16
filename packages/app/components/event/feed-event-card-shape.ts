/** Feed-only 4:6 portrait canvas; contain keeps the complete artwork visible. */
export const CARD_ASPECT = 4 / 6;
/** Keep portrait flyers readable without becoming tablet-sized posters. */
export const CARD_MAX_WIDTH = 384;
/** First-render estimate only; mounted cards report their actual content height. */
export const ESTIMATED_CARD_DETAILS_HEIGHT = 128;
export const CARD_HORIZONTAL_PADDING = 4;
export const CARD_VERTICAL_PADDING = 12;

/** Initial reservation until the content-driven card has been measured. */
export function feedEventCardHeight(width: number): number {
  const mediaWidth = Math.max(0, Math.min(width, CARD_MAX_WIDTH) - CARD_HORIZONTAL_PADDING * 2);
  return mediaWidth / CARD_ASPECT + ESTIMATED_CARD_DETAILS_HEIGHT + CARD_VERTICAL_PADDING * 2;
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


/** Width belongs in the key: text wraps differently after a responsive resize. */
export function feedEventCardMeasurementKey(id: string, width: number): string {
  return `${id}:${Math.round(Math.min(width, CARD_MAX_WIDTH))}`;
}
