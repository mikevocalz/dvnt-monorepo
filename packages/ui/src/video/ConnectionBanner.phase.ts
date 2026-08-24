/**
 * Transport status → banner phase. Non-split file, same resolution reason as
 * `*.types.ts`.
 *
 * Fishjam's PeerStatus is `"connecting" | "connected" | "error" | "idle"`
 * (@fishjam-cloud/react-client `dist/types/public.d.ts:44`) — there is no
 * `reconnecting`. "connecting" therefore covers two situations a user
 * experiences very differently: a first join, and a live session trying to get
 * back. Only the session's own history separates them, so the caller supplies
 * it rather than each screen inventing a flag.
 *
 * Both room legs were doing this inline and disagreeing: web treated every
 * "connecting" as a reconnect and had to pass a separate boolean to correct
 * the first-join case.
 */
import type { ConnectionPhase } from './ConnectionBanner.types';

export type FishjamPeerStatus = 'connecting' | 'connected' | 'error' | 'idle';

export function connectionPhaseFromPeerStatus(
  status: FishjamPeerStatus,
  everConnected: boolean,
): ConnectionPhase {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'idle':
      // Nothing has been attempted. Not a problem, so not a banner.
      return 'idle';
    case 'connecting':
      return everConnected ? 'reconnecting' : 'connecting';
    case 'error':
      return 'disconnected';
  }
}
