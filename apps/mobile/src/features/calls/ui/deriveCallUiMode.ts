/**
 * deriveCallUiMode — SINGLE source of truth for call UI state.
 *
 * Inputs come from Zustand store (server-truth role + phase).
 * Output is one of a strict set of UI modes. The call screen
 * renders EXACTLY ONE stage component per mode.
 *
 * INVARIANTS:
 * - Receiver NEVER sees CALLER_RINGING.
 * - Caller NEVER sees RECEIVER_CONNECTING.
 * - IN_CALL_VIDEO / IN_CALL_AUDIO only when phase === 'connected'.
 * - ENDED only when phase === 'call_ended'.
 */

import type {
  CallPhase,
  CallRole,
  CallType,
} from "@/src/video/stores/video-room-store";
import type { ConnectionState } from "@/src/video/types";

export type CallUiMode =
  | "CALLER_DIALING"
  | "CALLER_RINGING"
  | "RECEIVER_CONNECTING"
  | "RECONNECTING"
  | "IN_CALL_VIDEO"
  | "IN_CALL_AUDIO"
  | "ENDED"
  | "ERROR"
  | "PERMS_DENIED";

export interface DeriveCallUiModeInput {
  role: CallRole;
  phase: CallPhase;
  callType: CallType;
  remoteJoined: boolean;
  connectionStatus?: ConnectionState["status"];
}

export function deriveCallUiMode(input: DeriveCallUiModeInput): CallUiMode {
  const { role, phase, callType, connectionStatus } = input;

  // Terminal states — role-independent
  if (phase === "perms_denied") return "PERMS_DENIED";
  if (phase === "error") return "ERROR";
  if (phase === "call_ended") return "ENDED";
  if (phase === "reconnecting" || connectionStatus === "reconnecting") {
    return "RECONNECTING";
  }

  // Connected — both sides joined, media flowing
  if (phase === "connected") {
    return callType === "audio" ? "IN_CALL_AUDIO" : "IN_CALL_VIDEO";
  }

  // Pre-connect states — role-dependent
  if (role === "caller") {
    if (phase === "outgoing_ringing") return "CALLER_RINGING";
    // creating_room, joining_room, connecting_peer, starting_media
    return "CALLER_DIALING";
  }

  // role === "callee"
  // Runtime invariant: callee must never be in outgoing_ringing
  if (__DEV__ && phase === "outgoing_ringing") {
    console.error(
      `[deriveCallUiMode] INVARIANT VIOLATION: callee in phase=${phase}`,
    );
  }

  return "RECEIVER_CONNECTING";
}

export function getStatusLabel(mode: CallUiMode): string {
  switch (mode) {
    case "CALLER_DIALING":
      return "Calling…";
    case "CALLER_RINGING":
      return "Ringing…";
    case "RECEIVER_CONNECTING":
      return "Connecting…";
    case "RECONNECTING":
      return "Reconnecting…";
    case "IN_CALL_VIDEO":
    case "IN_CALL_AUDIO":
      return "";
    case "ENDED":
      return "Call Ended";
    case "ERROR":
      return "Call Failed";
    case "PERMS_DENIED":
      return "Permissions Required";
  }
}

export function isPreConnectMode(mode: CallUiMode): boolean {
  return (
    mode === "CALLER_DIALING" ||
    mode === "CALLER_RINGING" ||
    mode === "RECEIVER_CONNECTING"
  );
}

export function isInCallMode(mode: CallUiMode): boolean {
  return mode === "IN_CALL_VIDEO" || mode === "IN_CALL_AUDIO";
}
