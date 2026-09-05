/**
 * MoQ transport adapter for the room session machine.
 *
 * Verified against react-native-moq@0.3.0 (installed on
 * ws3a-dynamic-linkage-probe):
 *   SessionState   = 'idle' | 'connecting' | 'connected' | 'closed'
 *                    | `error:${string}`        lib/typescript/src/types.d.ts:2
 *   useSession(url, setup?) => Session          hooks/useSession.d.ts:2
 *   ConnectionStats { roundTripTimeMs?, packetsLost?, packetsReceived?, … }
 *                                               types.d.ts:107-117
 *   SessionEvents.statsUpdate(ConnectionStats)  types.d.ts:133
 *
 * Typed against a STRUCTURAL subset rather than importing react-native-moq,
 * because the package is a dependency of the MoQ branch and not of master —
 * importing it here would break the typecheck everywhere else. The real
 * SessionState is assignable to MoqSessionState, so the leg that has the
 * package passes its values in directly and tsc checks the fit at that call
 * site. Same approach as DvntSamplingContext in @dvnt/observability.
 *
 * The assignability was PROVEN, not assumed — on a checkout that has the
 * package, this compiles clean and fails the moment the union stops fitting:
 *
 *   // features/sneaky-lynk/session/moq-fit.probe.ts
 *   import type { SessionState, ConnectionStats } from "react-native-moq";
 *   import type { MoqSessionState, MoqConnectionStats } from "./moq-transport";
 *   const _s: MoqSessionState = null as unknown as SessionState;
 *   const _c: MoqConnectionStats = null as unknown as ConnectionStats;
 *
 * Verified against 0.3.0 by deleting the `error:${string}` member and watching
 * that probe fail, so it is a real check rather than a comment.
 */
import type { RoomTransportStatus } from "./useRoomSession";

/** Structural match for react-native-moq's SessionState. */
export type MoqSessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | `error:${string}`;

/** The fields of ConnectionStats this adapter reads. */
export interface MoqConnectionStats {
  roundTripTimeMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
}

/**
 * MoQ has no `reconnecting`: a session that drops goes back to `connecting`,
 * exactly as Fishjam's PeerStatus does. The session machine is what separates
 * a first join from a re-establish, so this maps to the transport vocabulary
 * and lets the machine decide — the same division that fixed the
 * "Reconnecting" on a first join bug on the Fishjam leg.
 *
 * `closed` is disconnected rather than an error: a room the host ended closes
 * cleanly, and calling that an error would send the machine down a retry path
 * for a room that is gone.
 */
export function transportStatusFromMoq(state: MoqSessionState): RoomTransportStatus {
  if (state.startsWith("error:")) return "error";
  switch (state) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "closed":
      return "disconnected";
    default:
      // A state added by a future SDK version. Treating an unknown as an error
      // would tear down a working room, so it reads as "still connecting" —
      // the machine's reconnect budget still bounds it if it never resolves.
      return "connecting";
  }
}

/** Loss ratio above which a link is degraded rather than healthy. */
export const DEGRADED_LOSS_RATIO = 0.05;
/** Round-trip beyond which conversation stops feeling live. */
export const DEGRADED_RTT_MS = 400;

/**
 * Whether the link is bad enough to tell the user about, from the stats
 * `statsUpdate` delivers. This is the producer the machine's `degraded` state
 * never had — before 0.3.0 there was no stats stream to derive it from, so
 * `degraded` could only ever be reached by backgrounding.
 *
 * ponytail: a single sample, no smoothing. One unlucky poll can flip the
 * banner; if that reads as flapping on a real network, average over the last
 * few samples rather than lowering the thresholds.
 */
export function isDegradedLink(stats: MoqConnectionStats): boolean {
  const { roundTripTimeMs, packetsLost, packetsReceived } = stats;
  if (typeof roundTripTimeMs === "number" && roundTripTimeMs > DEGRADED_RTT_MS) {
    return true;
  }
  if (typeof packetsLost === "number" && typeof packetsReceived === "number") {
    const total = packetsLost + packetsReceived;
    // Nothing received yet is not evidence of loss — it is evidence of nothing.
    if (total > 0) return packetsLost / total > DEGRADED_LOSS_RATIO;
  }
  return false;
}
