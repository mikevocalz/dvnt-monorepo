/**
 * Shared prop contract for the ConnectionBanner platform split. Lives in a
 * non-split file so the base / .web / .native files and the package index can
 * all import it without `./ConnectionBanner` resolving back to a platform
 * sibling under platform-suffix module resolution (apps/web's moduleSuffixes).
 */
import type { ReactNode } from 'react';

/**
 * One vocabulary for both a personal call (Fishjam) and a Lynk room. Mirrors
 * the room session machine's states minus the two a banner never renders:
 * `idle` (nothing to report) and `ended` (the room is gone; that is a sheet,
 * not a strip).
 */
export type ConnectionPhase =
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'reconnecting'
  | 'disconnected';

export interface ConnectionBannerProps {
  phase: ConnectionPhase;
  /**
   * Reconnect attempt and its ceiling. Renders as `2/5` in mono — a bounded
   * retry is transactional data, and showing the ceiling is the difference
   * between "still trying" and "about to give up".
   */
  attempt?: { current: number; max: number };
  /** What the transport reported. Shown beneath the label when present. */
  detail?: string;
  /**
   * Recovery affordance — a Rejoin control, a Settings link. A slot, not a
   * `showRejoin?` flag: flags multiply render paths (code-standards §2).
   */
  action?: ReactNode;
  className?: string;
}
