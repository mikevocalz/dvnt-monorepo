/**
 * Scan gate — one QR in front of the lens is ONE scan.
 *
 * expo-camera's web scanner reports every decode (~3/s) for as long as a code
 * stays in frame. At a door that means: guest is admitted (green), staff taps
 * "scan next" while the phone is still held up, the same code is decoded again
 * within 300ms, and the guest who was just let in gets a red ALREADY SCANNED.
 *
 * Rule: a payload is emitted when it is NEW, or when the same payload comes
 * back after being ABSENT from the frame for `absenceMs`. Holding a code in
 * view never re-fires; taking it away and presenting it again does.
 *
 * Pure (injectable clock) so the timing is unit-tested, not eyeballed.
 */
export interface ScanGate {
  /** Feed every decode. Returns true when this one should be emitted. */
  accept(payload: string): boolean;
  /**
   * Scanning resumed after a pause (result card dismissed). The last code may
   * still be in frame — it must now be absent for `absenceMs` from THIS moment.
   */
  resume(): void;
  reset(): void;
}

export function createScanGate(
  opts: { absenceMs?: number; now?: () => number } = {},
): ScanGate {
  const absenceMs = opts.absenceMs ?? 1200;
  const now = opts.now ?? Date.now;
  let last: string | null = null;
  let lastSeenAt = 0;

  return {
    accept(payload) {
      if (!payload) return false;
      const t = now();
      const isNew = payload !== last;
      const cameBack = t - lastSeenAt >= absenceMs;
      last = payload;
      lastSeenAt = t;
      return isNew || cameBack;
    },
    resume() {
      if (last !== null) lastSeenAt = now();
    },
    reset() {
      last = null;
      lastSeenAt = 0;
    },
  };
}
