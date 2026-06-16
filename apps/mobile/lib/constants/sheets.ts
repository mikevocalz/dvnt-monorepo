/**
 * Shared Gorhom BottomSheet constants.
 *
 * ALL sheets in the app must use these snap points for consistency.
 * Default open index is 0 (maps to ~65% height).
 *
 * Rule: No sheet may open below 60% height unless intentionally a "mini" sheet.
 */

/** Standard content sheets (likes, comments, filters, share) */
export const SHEET_SNAPS = ["65%", "92%"] as const;

/** Default open snap index — 65% height */
export const SHEET_DEFAULT_INDEX = 0;

/** Tall content sheets (comments with input, full lists) */
export const SHEET_SNAPS_TALL = ["85%", "95%"] as const;

/** Action sheets (profile actions, post actions — shorter content) */
export const SHEET_SNAPS_ACTION = ["55%"] as const;

/** Full-height sheets (promote event, city picker, etc.) */
export const SHEET_SNAPS_FULL = ["85%"] as const;
