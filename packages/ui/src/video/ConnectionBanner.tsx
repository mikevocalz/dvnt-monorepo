/**
 * ConnectionBanner — one connection status strip for every DVNT call and room.
 *
 * Promoted from three separate implementations that had drifted apart:
 * `features/sneaky-lynk/ui/ConnectionBanner` (a string union), a private
 * function inside `sneaky-lynk/screens/room.web.tsx` (a raw peerStatus string),
 * and `features/video/ui/ConnectionBanner` (a `{status, error}` object). Three
 * palettes, three copies, three sets of states. Consumed by 2+ features and
 * forked across web and native, so it graduates here per code-standards §2.
 *
 * Colour comes from the documented palette, not a fourth invention:
 *   - `connecting` is neutral. Nothing has gone wrong yet, so it does not shout.
 *   - `degraded` and `reconnecting` use `gold #F5C518` — the urgency token.
 *   - `disconnected` uses `signal #FC253A`, which the system reserves for
 *     live and destructive. A dropped call is the destructive case.
 * The Deviant Gradient appears nowhere here: it is spent on the primary action,
 * and a status strip is not one.
 *
 * This base file is the TypeScript resolution target + the prop contract; the
 * platform files provide the real rendering.
 */

export type { ConnectionPhase, ConnectionBannerProps } from './ConnectionBanner.types';
import type { ConnectionBannerProps } from './ConnectionBanner.types';

/**
 * Base implementation is intentionally inert — Metro/web always resolve a
 * platform file. Kept so bare `import { ConnectionBanner } from "@dvnt/ui"`
 * typechecks.
 */
export function ConnectionBanner(_props: ConnectionBannerProps): null {
  return null;
}
