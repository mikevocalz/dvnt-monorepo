/** Native call browsing is separate from the live incoming-call envelope. */
export interface WatchCallPerson { id: string; name: string; avatarURL?: string }
export interface WatchCallRecent { id: string; people: WatchCallPerson[]; createdAt: string; direction: "incoming" | "outgoing"; status: string; isVideo: boolean }
export interface WatchCallDirectory { protocol: 2; accountGen: string; syncedAt: number; people: WatchCallPerson[]; recents: WatchCallRecent[]; error?: string }
export interface WatchCallDirectoryCommand { protocol: 2; accountGen: string; operationId: string; type: "callDirectoryAction"; action: "search" | "start_on_phone"; query?: string; participantIds?: string[]; callType?: "audio" | "video"; issuedAt: number; expiresAt: number }
export interface WatchCallDirectoryResult { protocol: 2; accountGen: string; operationId: string; status: "confirmed" | "failed" | "rejected"; people?: WatchCallPerson[]; message?: string }
export function validateCallDirectoryCommand(value: unknown, generation: string, now = Date.now() / 1000): WatchCallDirectoryCommand | null {
  if (!value || typeof value !== "object") return null;
  const c = value as WatchCallDirectoryCommand;
  if (c.protocol !== 2 || c.accountGen !== generation || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.operationId) || c.type !== "callDirectoryAction" || !Number.isFinite(c.issuedAt) || !Number.isFinite(c.expiresAt) || c.issuedAt > now + 5 || c.expiresAt <= now || c.expiresAt - c.issuedAt > 30 || c.expiresAt <= c.issuedAt) return null;
  if (c.action === "search") return typeof c.query === "string" && c.query.trim().length >= 1 && c.query.length <= 60 ? c : null;
  if (c.action !== "start_on_phone" || !["audio", "video"].includes(c.callType ?? "") || !Array.isArray(c.participantIds) || c.participantIds.length < 1 || c.participantIds.length > 3 || new Set(c.participantIds).size !== c.participantIds.length || c.participantIds.some((id) => typeof id !== "string" || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))) return null;
  return c;
}
