/**
 * RoomTimer — the free-room countdown badge.
 *
 * Set in Space Mono, because the design system reserves mono for transactional
 * and temporal data and names the room countdown as the case it exists for.
 * Both previous copies used the default face; the web one also used tailwind's
 * rose-500, which is not a DVNT token. This uses `signal #FC253A`: a room about
 * to end is the destructive case the token is reserved for.
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
