/** Credential-free wire contract, mirrored by WatchProtocol.swift and WatchProtocol.kt. */
export const WATCH_PROTOCOL = 2 as const;

export interface WatchAttachment {
  id: string;
  kind: "image" | "video";
  thumbURL?: string;
  fullURL?: string;
  alt?: string;
}

export interface WatchMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  outgoing: boolean;
  text: string;
  createdAt: string;
  attachments: WatchAttachment[];
  reactions?: { emoji: string; count: number; mine: boolean }[];
}

export interface WatchCursor { createdAt: string; id: string }
export interface WatchThreadPage {
  protocol: 2;
  accountGen: string;
  conversationId: string;
  messages: WatchMessage[];
  olderCursor?: WatchCursor;
}

export interface WatchSendCommand {
  protocol: 2;
  accountGen: string;
  operationId: string;
  type: "dmReply";
  conversationId: string;
  text: string;
  issuedAt: number;
  expiresAt: number;
}

export interface WatchCommandResult {
  protocol: 2;
  accountGen: string;
  operationId: string;
  status: "sent" | "failed" | "rejected" | "expired";
  serverId?: string;
  error?: string;
}

export function epochSeconds(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.floor(value > 1e11 ? value / 1000 : value);
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

export function validateSendCommand(
  raw: unknown, accountGen: string, knownIds: readonly string[], now = Date.now() / 1000,
): WatchSendCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.protocol !== 2 || c.accountGen !== accountGen || !accountGen || c.type !== "dmReply") return null;
  if (typeof c.operationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c.operationId)) return null;
  if (typeof c.conversationId !== "string" || !knownIds.includes(c.conversationId)) return null;
  if (typeof c.text !== "string" || !c.text.trim() || c.text.trim().length > 500) return null;
  if (typeof c.issuedAt !== "number" || typeof c.expiresAt !== "number" ||
      !Number.isFinite(c.issuedAt) || !Number.isFinite(c.expiresAt) ||
      c.issuedAt > now + 30 || c.expiresAt <= now || c.expiresAt <= c.issuedAt ||
      c.expiresAt - c.issuedAt > 86400) return null;
  return { ...c, text: c.text.trim() } as unknown as WatchSendCommand;
}
