/**
 * Shared, transport-agnostic contracts for the Lynk Live (MoQ) hooks.
 *
 * `useLynkBroadcast` / `useLynkViewer` are the universal seam: both the web
 * (`@moq/*` directly) and native (WebView-hosted `@moq` player) implementations
 * satisfy these so the screens stay transport-agnostic.
 */

import type { LynkState } from "./lynkState";

/** A discovered live publisher in the room namespace. */
export interface LynkPublisher {
  /** Full MoQ path, e.g. `lynk/<roomId>/<peerId>`. */
  path: string;
  /** Trailing segment — the peer id (maps to a room member). */
  peerId: string;
}

/** Common surface both platforms expose for the viewer. */
export interface LynkViewerBase {
  state: LynkState;
  error: string | null;
  /** Live publishers (1 when only host, 2 when cohost joins) — discovery-driven. */
  publishers: LynkPublisher[];
  /** Number of viewers in the room (from Supabase presence, not MoQ). */
  viewerCount: number;
  muted: boolean;
  setMuted: (m: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  /** Tear down the subscription (call on leave/unmount/background). */
  leave: () => void;
}

/** Common surface both platforms expose for the broadcaster (host/cohost). */
export interface LynkBroadcastBase {
  state: LynkState;
  error: string | null;
  isLive: boolean;
  cameraEnabled: boolean;
  micEnabled: boolean;
  setCameraEnabled: (on: boolean) => void;
  setMicEnabled: (on: boolean) => void;
  /** Other live publishers in the room (e.g. the cohost) — discovery-driven. */
  coPublishers: LynkPublisher[];
  viewerCount: number;
  /** Begin publishing camera + mic. */
  goLive: () => Promise<void>;
  /** Stop publishing + tear down (call on leave/unmount/background). */
  end: () => void;
}
