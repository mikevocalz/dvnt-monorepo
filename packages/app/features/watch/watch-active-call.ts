export interface WatchActiveCallEnvelope { protocol: 2; accountGen: string; syncedAt: number; expiresAt: number; roomId?: string; phase: "connecting" | "ringing" | "connected" | "reconnecting" | "ended"; peerStatus: string; name: string; isVideo: boolean; muted: boolean; canMute: boolean }
export interface WatchActiveCallCommand { protocol: 2; accountGen: string; operationId: string; type: "activeCallAction"; roomId: string; expectedStatus: WatchActiveCallEnvelope["phase"]; action: "set_muted" | "end"; muted?: boolean; issuedAt: number; expiresAt: number }
export interface WatchActiveCallResult { protocol: 2; accountGen: string; operationId: string; roomId: string; status: "confirmed" | "failed" | "rejected"; message?: string }
export function validateActiveCallCommand(value: unknown, generation: string, roomId: string | null, now = Date.now() / 1000): WatchActiveCallCommand | null {
  if (!value || typeof value !== "object") return null;
  const c = value as WatchActiveCallCommand;
  if (!["connecting", "ringing", "connected", "reconnecting"].includes(c.expectedStatus) || c.protocol !== 2 || c.type !== "activeCallAction" || c.accountGen !== generation || !roomId || c.roomId !== roomId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.operationId) || !Number.isFinite(c.issuedAt) || !Number.isFinite(c.expiresAt) || c.issuedAt > now + 5 || c.expiresAt <= now || c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 30) return null;
  return c.action === "end" || (c.action === "set_muted" && typeof c.muted === "boolean") ? c : null;
}
/** A signaling acceptance is insufficient: the transport and a remote peer must exist. */
export function activeCallPhase(ended: boolean, peerStatus: string, callPhase: string, remoteCount: number): WatchActiveCallEnvelope["phase"] {
  if (ended) return "ended";
  if (peerStatus !== "connected") return callPhase === "reconnecting" ? "reconnecting" : "connecting";
  if (callPhase === "outgoing_ringing") return "ringing";
  if (callPhase === "reconnecting") return "reconnecting";
  return callPhase === "connected" && remoteCount > 0 ? "connected" : "connecting";
}

export function microphoneMatches(tracks: Array<{ enabled: boolean; readyState?: string }>, desiredEnabled: boolean): boolean {
  return tracks.length > 0 && tracks.every((track) => track.readyState !== "ended" && track.enabled === desiredEnabled);
}
