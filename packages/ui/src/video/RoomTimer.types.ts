/**
 * Shared prop contract for the RoomTimer platform split. Non-split file — see
 * the note in `VideoTile.types.ts`.
 */
export interface RoomTimerProps {
  /** When the room started, epoch ms. A server fact, not a mount time. */
  startedAt?: number;
  /** Absolute server deadline; null means unlimited. Takes precedence over legacy timing. */
  endsAt?: string | null;
  /** Defaults to the free-tier allowance. */
  durationMs?: number;
  /** Fired once, when the countdown reaches zero. */
  onTimeUp?: () => void;
  className?: string;
  /** Dense native header badge; web retains a readable full-width timer row. */
  compact?: boolean;
}
