import { epochSeconds } from "./contracts/v2";
import type { CallSignal } from "@dvnt/app/lib/api/call-signals";

export interface WatchCallDTO {
  protocol?: 2;
  accountGen?: string;
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
export type WatchCallAction = "accept" | "accept_audio_only" | "decline";

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
    ringingSince: epochSeconds(signal.created_at),
  };
}
