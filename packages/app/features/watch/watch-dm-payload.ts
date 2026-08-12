/**
 * Projects the member's existing conversation list into the compact DTO the
 * Apple Watch consumes. Mirrors `apps/mobile/targets/watch/DMModels.swift`
 * (WatchDM / WatchDMEnvelope) — keep the two in lockstep.
 *
 * The watch is a presenter: these rows come from the SAME `useConversations`
 * query the Messages tab renders. No new network, no new server code, and no
 * DVNT credentials on the wrist — a reply typed there is relayed back to the
 * phone, which performs the actual send.
 *
 * ponytail: previews only, no thread history. The wrist job is "who wants me,
 * and can I answer in one line" — add a messages array to the DTO when the
 * wrist genuinely needs context before replying.
 */

import type { Conversation } from "@dvnt/app/lib/api/messages";
import { watchRendition, WATCH_RENDITION } from "./watch-rendition";

export interface WatchDMDTO {
  /** Conversation id (string form; the send path parses it back to an int). */
  id: string;
  /** Display name — group name for groups, the other member otherwise. */
  name: string;
  /** @handle for a 1:1; empty for a group. */
  handle: string;
  /**
   * Sender avatar, for the Messages Door's 2x2 mosaic on the watch.
   * Optional: a group has no single face, and an avatar-less member is normal —
   * AvatarMosaic fills empty slots with the Deviant Gradient rather than grey.
   * Costs no extra query; `Conversation.user.avatar` is already loaded.
   */
  avatarURL?: string;
  /** Last message text, rendered verbatim. May be empty for a fresh thread. */
  preview: string;
  /** Epoch seconds parsed from the conversation's ISO timestamp. */
  timestamp: number;
  unread: boolean;
  isGroup: boolean;
}

export interface WatchDMEnvelope {
  dms: WatchDMDTO[];
  /** Epoch seconds, stamped by the phone so the watch shows honest staleness. */
  syncedAt: number;
}

/** What the wrist sends back when the wearer answers. */
export interface WatchDMReply {
  conversationId: string;
  text: string;
}

function toEpochSeconds(value?: string): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export function toWatchDM(c: Conversation): WatchDMDTO {
  const isGroup = !!c.isGroup;
  return {
    id: String(c.id),
    name: isGroup
      ? c.groupName || "Group"
      : c.user?.name || c.user?.username || "DVNT",
    handle: isGroup ? "" : c.user?.username ? `@${c.user.username}` : "",
    avatarURL: isGroup
      ? undefined
      : watchRendition(c.user?.avatar, WATCH_RENDITION.avatar),
    preview: c.lastMessage ?? "",
    timestamp: toEpochSeconds(c.timestamp),
    unread: !!c.unread,
    isGroup,
  };
}

/**
 * Newest first, capped. The WCSession application context tops out around
 * 262 KB and is shared with tickets and broadcasts, so the wrist carries a
 * glance-depth slice; the rest stays on the phone.
 */
const MAX_DMS = 20;

export function buildDMEnvelope(
  conversations: Conversation[] | undefined,
): WatchDMEnvelope {
  const dms = (conversations ?? [])
    .map(toWatchDM)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_DMS);
  return { dms, syncedAt: Math.floor(Date.now() / 1000) };
}

/** Stable signature to skip redundant pushes (id + unread + preview). */
export function dmSignature(env: WatchDMEnvelope): string {
  return env.dms
    .map((d) => `${d.id}:${d.unread ? 1 : 0}:${d.preview}`)
    .join("|");
}

/**
 * Trust boundary: the wrist is a different process sending free text into the
 * member's outbox. Accept only a non-empty, length-capped string against a
 * conversation id we actually know about — never relay an id the phone has not
 * seen, or a body long enough to be a paste-bomb.
 */
const MAX_REPLY_CHARS = 500;

export function validateDMReply(
  raw: unknown,
  knownIds: readonly string[],
): WatchDMReply | null {
  if (!raw || typeof raw !== "object") return null;
  const { conversationId, text } = raw as Record<string, unknown>;
  if (typeof conversationId !== "string" || typeof text !== "string")
    return null;
  const body = text.trim();
  if (!body || body.length > MAX_REPLY_CHARS) return null;
  if (!knownIds.includes(conversationId)) return null;
  return { conversationId, text: body };
}
