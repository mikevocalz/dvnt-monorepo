/**
 * Projects the app's existing host-broadcast activity entries into the compact
 * DTO the Apple Watch consumes. Mirrors `apps/mobile/targets/watch/BroadcastModels.swift`
 * (WatchBroadcast / WatchBroadcastEnvelope) — keep the two in lockstep.
 *
 * The watch is a presenter, not a new pipeline: these rows come from the SAME
 * activity/notification stream the phone already renders (type `event_broadcast`,
 * delivered by the `event-broadcast-message` edge function). The server has
 * already scoped delivery by audience — a member only ever has rows they were in
 * the audience for, so the watch renders honestly without re-deriving audience.
 * See docs/watch-broadcast-fit.md.
 */

import type { Activity } from "@dvnt/app/lib/hooks/use-activities-query";

/**
 * Coarse intent derived from the message text — STYLING ONLY. The host's words
 * are sacrosanct; we never rewrite or truncate them, we only pick a glyph + a
 * haptic weight + an accent. Keep this in lockstep with `BroadcastIntent` in
 * BroadcastModels.swift (the watch re-derives defensively, but agreeing here
 * keeps phone-side previews consistent).
 */
export type WatchBroadcastIntent = "urgent" | "directional" | "general";

export interface WatchBroadcastDTO {
  id: string;
  eventId: string;
  eventTitle: string;
  /** Sender handle; broadcasts have no actor, so this is usually the host/event. */
  host: string;
  /** Optional title the host set (falls back to the event title on the server). */
  title?: string;
  /** The message body — rendered verbatim, never truncated to fit chrome. */
  body: string;
  intent: WatchBroadcastIntent;
  /** Epoch seconds (parsed from the activity's ISO `createdAt`). */
  createdAt: number;
  read: boolean;
}

export interface WatchBroadcastEnvelope {
  broadcasts: WatchBroadcastDTO[];
  /** Epoch seconds, stamped by the phone so the watch shows honest staleness. */
  syncedAt: number;
}

const URGENT = /\b(now|starting|start|begins?|begin|5\s*min|five\s*min|last\s*call|doors?|closing|hurry|immediately|tonight)\b/i;
const DIRECTIONAL = /\b(front|stage|vip|back|left|right|entrance|gate|move|head|come|to the|upstairs|downstairs|floor)\b/i;

/** Conservative intent inference — defaults to `general`; never invents meaning. */
export function inferIntent(text: string): WatchBroadcastIntent {
  if (URGENT.test(text)) return "urgent";
  if (DIRECTIONAL.test(text)) return "directional";
  return "general";
}

function toEpochSeconds(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export function toWatchBroadcast(a: Activity): WatchBroadcastDTO {
  const body = a.payload?.body ?? a.payload?.summary ?? "";
  return {
    id: a.id,
    eventId: a.event?.id ?? a.entityId ?? "",
    eventTitle: a.event?.title ?? a.payload?.title ?? "Event",
    host: a.user?.username || "Host",
    title: a.payload?.title,
    body,
    intent: inferIntent(body),
    createdAt: toEpochSeconds(a.createdAt),
    read: !!a.isRead,
  };
}

/**
 * Build the envelope from the member's activity feed. Only `event_broadcast`
 * rows with an actual body belong on the wrist; newest first. We cap the set so
 * a long history never bloats the WCSession application context (watchOS limits
 * it to ~262 KB) — older messages stay reachable on the phone.
 */
const MAX_BROADCASTS = 40;

export function buildBroadcastEnvelope(
  activities: Activity[],
): WatchBroadcastEnvelope {
  const broadcasts = activities
    .filter((a) => a.type === "event_broadcast")
    .map(toWatchBroadcast)
    .filter((b) => b.body.trim().length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_BROADCASTS);
  return { broadcasts, syncedAt: Math.floor(Date.now() / 1000) };
}

/** Stable signature to skip redundant pushes (id + read-state per broadcast). */
export function broadcastSignature(env: WatchBroadcastEnvelope): string {
  return env.broadcasts
    .map((b) => `${b.id}:${b.read ? 1 : 0}`)
    .sort()
    .join("|");
}
