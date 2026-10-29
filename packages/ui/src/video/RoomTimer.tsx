/**
 * RoomTimer — the server-limited room countdown badge.
 *
 * Set in Space Mono, because the design system reserves mono for transactional
 * and temporal data and names the room countdown as the case it exists for.
 * The timer stays visible from the start. Signal red marks the final thirty
 * seconds; the deadline always comes from the server when available.
 *
 * This base file is the TypeScript resolution target + the prop contract; the
 * platform files provide the real rendering.
 */

export type { RoomTimerProps } from './RoomTimer.types';
export {
  FREE_ROOM_DURATION_MS,
  COUNTDOWN_THRESHOLD_MS,
  countdownAt,
  useRoomCountdown,
} from './RoomTimer.countdown';
import type { RoomTimerProps } from './RoomTimer.types';

/**
 * Base implementation is intentionally inert — Metro/web always resolve a
 * platform file. Kept so bare `import { RoomTimer } from "@dvnt/ui"` typechecks.
 */
export function RoomTimer(_props: RoomTimerProps): null {
  return null;
}
