/**
 * The incoming-call DTO the Apple Watch consumes. Mirrors `WatchIncomingCall`
 * in `apps/mobile/targets/watch/CallStore.swift` — keep the two in lockstep.
 *
 * The watch is a remote control for the ring, not a call endpoint: watchOS has
 * no WebRTC stack and no public duplex-audio route for third-party apps, so the
 * room is joined on the phone. Nothing room-joining (token, URL, peer id) is
 * carried here, because nothing on the wrist could use it.
 */

import type { CallSignal } from "@dvnt/app/lib/api/call-signals";

export interface WatchCallDTO {
  /** Stringified `call_signals.id`. The column is a bigint; the wire format is
   *  a string so the id survives WCSession's plist round-trip unambiguously. */
  id: string;
  callerName: string;
  callerAvatar?: string;
  isVideo: boolean;
  isGroup: boolean;
  /** Epoch seconds, stamped by the phone — the watch clock can drift. */
  ringingSince: number;
}

/** What the wearer chose. */
export type WatchCallAction = "accept" | "decline";

/** The id the watch knows this call by. Use it on every clear/compare. */
export function watchCallId(signal: Pick<CallSignal, "id">): string {
  return String(signal.id);
}

export function toWatchCall(signal: CallSignal): WatchCallDTO {
  return {
    id: watchCallId(signal),
    callerName: signal.caller_username || "Unknown",
    callerAvatar: signal.caller_avatar ?? undefined,
    isVideo: (signal.call_type || "video") !== "audio",
    isGroup: !!signal.is_group,
    ringingSince: Math.floor(Date.now() / 1000),
  };
}
