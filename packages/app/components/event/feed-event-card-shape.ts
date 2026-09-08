import { CONTENT_MAX_WIDTH } from "@dvnt/app/components/layout/screen-shell";

/**
 * Shape of the inline feed event card — shared by the web card, the native card
 * and the web masonry packer.
 *
 * It lives in its own module because the numbers have drifted before: when the
 * packer repeated the card's height instead of importing it, the column below
 * reserved the wrong height and left a void in the grid. One definition, three
 * consumers.
 */

/**
 * Landscape rounded rectangle. An event in the feed reads as a wide banner, not
 * as another portrait tile competing with the posts around it.
 *
 * A RATIO rather than a fixed height: a fixed height ignores the width it is
 * given, so the same card was a squat letterbox in a wide column and too tall
 * in a narrow one.
 */
export const CARD_ASPECT = 16 / 9;

/**
 * Width ceiling for the native card, which spans the FULL feed width rather
 * than sitting in a masonry column like the web one. `max-w-3xl` = 48rem.
 *
 * Capping the WIDTH rather than clamping the height keeps one rule: the card is
 * 16:9 at every size, so a phone and a tablet show the same shape instead of
 * the tablet quietly getting a different, flatter card. The old fixed 200pt
 * height stretched to 1024pt on iPad and read as a 5:1 sliver — the band of
 * empty space above the title.
 */
export const CARD_MAX_WIDTH = CONTENT_MAX_WIDTH;

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
