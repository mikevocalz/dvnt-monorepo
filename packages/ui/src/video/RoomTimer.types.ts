/**
 * Shared prop contract for the RoomTimer platform split. Non-split file — see
 * the note in `VideoTile.types.ts`.
 */
export interface RoomTimerProps {
  /** When the room started, epoch ms. A server fact, not a mount time. */
  startedAt: number;
  /** Defaults to the free-tier allowance. */
  durationMs?: number;
  /** Fired once, when the countdown reaches zero. */
  onTimeUp?: () => void;
  className?: string;
}
