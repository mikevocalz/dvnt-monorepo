/**
 * Phone → Watch bridge. Two transports, both best-effort and crash-safe:
 *
 *  1. WCSession.updateApplicationContext (via react-native-watch-connectivity) —
 *     latest-wins coalesced snapshot of the member's current state. There is a
 *     SINGLE application-context slot, so tickets, broadcasts and conversation
 *     previews are merged into one dictionary (`{ payload, broadcasts, dms }`);
 *     pushing one never wipes the others (see `pushMergedContext`). Note that
 *     `dms` is watch-only — see `pushDMs`.
 *     transferUserInfo is also used for prompt
 *     delivery of a fresh snapshot when the watch is reachable.
 *  2. ExtensionStorage (via @bacons/apple-targets) — writes the same snapshots
 *     into the iPhone App Group (group.com.dvnt.app) for the iPhone-side widget.
 *     (The WATCH reads its own per-device group via WCSession, not this one.)
 *
 * Native deps are loaded lazily and guarded so JS never hard-crashes when a module
 * is absent (web, Android, or a dev build before `expo prebuild` adds the targets).
 */

import { Platform } from "react-native";
import type { WatchTicketEnvelope } from "./watch-payload";
import type { WatchBroadcastEnvelope } from "./watch-broadcast-payload";
import type { WatchCallAction, WatchCallDTO } from "./watch-call-payload";
import type { WatchDoorEnvelope } from "./watch-door-payload";
import {
  validateDMReply,
  type WatchDMEnvelope,
  type WatchDMReply,
} from "./watch-dm-payload";
import {
  useWatchSettingsStore,
  watchFeatureEnabled,
  type WatchFeatureKey,
} from "./watch-settings-store";

const IPHONE_APP_GROUP = "group.com.dvnt.app";
const TICKETS_STORAGE_KEY = "dvnt.tickets.envelope";
const BROADCASTS_STORAGE_KEY = "dvnt.broadcasts.envelope";

let warnedConnectivity = false;
let warnedStorage = false;

// The single application-context slot is shared; retain each half so a push of
// one never drops the other (the two sync hooks fire independently).
let lastTicketsPayload: string | null = null;
let lastBroadcastsPayload: string | null = null;
let lastDMsPayload: string | null = null;
let lastDoorPayload: string | null = null;

/**
 * Lazy, optional requires so a missing native module degrades gracefully.
 *
 * These MUST stay as literal strings: Metro resolves requires statically and
 * rejects `require(someVariable)` outright ("Invalid call ... require(name)"),
 * which failed the production bundle. A shared helper taking the name as an
 * argument is exactly the shape that breaks, so each module gets its own.
 */
function requireWatchConnectivity<T = any>(): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-watch-connectivity") as T;
  } catch {
    return null;
  }
}

function requireAppleTargets<T = any>(): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@bacons/apple-targets") as T;
  } catch {
    return null;
  }
}

function connectivityModule(): any | null {
  const mod = requireWatchConnectivity<any>();
  if (!mod && !warnedConnectivity) {
    warnedConnectivity = true;
    console.info(
      "[watch-bridge] react-native-watch-connectivity not installed — skipping watch push",
    );
  }
  return mod;
}

/** Push the merged latest-wins snapshot (tickets + broadcasts) in one context. */
function pushMergedContext(mod: any): void {
  if (typeof mod.updateApplicationContext !== "function") return;
  const ctx: Record<string, string> = {};
  if (lastTicketsPayload != null) ctx.payload = lastTicketsPayload;
  if (lastBroadcastsPayload != null) ctx.broadcasts = lastBroadcastsPayload;
  if (lastDMsPayload != null) ctx.dms = lastDMsPayload;
  if (lastDoorPayload != null) ctx.door = lastDoorPayload;
  if (Object.keys(ctx).length === 0) return;
  try {
    mod.updateApplicationContext(ctx);
  } catch (err) {
    console.warn("[watch-bridge] updateApplicationContext failed", err);
  }
}

function writeAppGroup(key: string, json: string): void {
  const mod = requireAppleTargets<any>();
  const ExtensionStorage = mod?.ExtensionStorage;
  if (!ExtensionStorage) {
    if (!warnedStorage) {
      warnedStorage = true;
      console.info(
        "[watch-bridge] ExtensionStorage unavailable — skipping App Group write",
      );
    }
    return;
  }
  try {
    const storage = new ExtensionStorage(IPHONE_APP_GROUP);
    storage.set(key, json);
    // Nudge any iPhone-side widget timeline to refresh.
    ExtensionStorage.reloadWidget?.();
  } catch (err) {
    console.warn("[watch-bridge] App Group write failed", err);
  }
}

async function isReachable(mod: any): Promise<boolean> {
  return typeof mod.getReachability === "function"
    ? await mod.getReachability().catch(() => false)
    : false;
}

/**
 * Sync the current ticket set to the watch + iPhone App Group. No-op off iOS.
 */
export async function syncTicketsToWatch(
  env: WatchTicketEnvelope,
): Promise<void> {
  if (!watchFeatureEnabled("tickets")) return;
  await pushTickets(env);
}

/** Unguarded push — the switch is checked by callers, so disabling a feature
 *  can still send the empty envelope that clears the wrist. */
async function pushTickets(env: WatchTicketEnvelope): Promise<void> {
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(env);
  lastTicketsPayload = json;
  writeAppGroup(TICKETS_STORAGE_KEY, json);

  const mod = connectivityModule();
  if (!mod) return;
  try {
    pushMergedContext(mod);
    // If reachable, also queue a prompt snapshot so a `scanned` flip arrives fast
    // (the watch fires a success haptic on the used-state transition).
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ payload: json });
    }
  } catch (err) {
    console.warn("[watch-bridge] ticket push failed", err);
  }
}

/**
 * Sync the member's host-broadcast history to the watch + iPhone App Group.
 * No-op off iOS. Shares the application-context slot with tickets.
 */
export async function syncBroadcastsToWatch(
  env: WatchBroadcastEnvelope,
): Promise<void> {
  if (!watchFeatureEnabled("broadcasts")) return;
  await pushBroadcasts(env);
}

/** Unguarded push — see `pushTickets`. */
async function pushBroadcasts(env: WatchBroadcastEnvelope): Promise<void> {
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(env);
  lastBroadcastsPayload = json;
  writeAppGroup(BROADCASTS_STORAGE_KEY, json);

  const mod = connectivityModule();
  if (!mod) return;
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ broadcasts: json });
    }
  } catch (err) {
    console.warn("[watch-bridge] broadcast push failed", err);
  }
}

/**
 * Sync the member's conversation previews to the watch. No-op off iOS. Shares
 * the application-context slot with tickets and broadcasts.
 */
export async function syncDMsToWatch(env: WatchDMEnvelope): Promise<void> {
  if (!watchFeatureEnabled("messages")) return;
  await pushDMs(env);
}

/** Unguarded push — see `pushTickets`. */
async function pushDMs(env: WatchDMEnvelope): Promise<void> {
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(env);
  lastDMsPayload = json;
  // Deliberately NOT written to the iPhone App Group like tickets/broadcasts:
  // that copy exists for the iPhone widget, and no widget shows DMs. Message
  // previews sitting in a container nothing reads is footprint for nothing.

  const mod = connectivityModule();
  if (!mod) return;
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ dms: json });
    }
  } catch (err) {
    console.warn("[watch-bridge] dm push failed", err);
  }
}

/**
 * Listen for a reply typed on the wrist and hand it to `onReply`, which owns
 * the actual send (the watch never holds DVNT auth — it only carries words).
 *
 * `knownIds` is read per-message, not captured, so a thread that arrived after
 * this listener mounted is still replyable. Replies are validated against that
 * set and de-duplicated: `sendMessage` and `transferUserInfo` can both land for
 * one tap, and a double send is a visible, embarrassing bug.
 */
export function registerWatchDMReplyHandler(
  knownIds: () => readonly string[],
  onReply: (reply: WatchDMReply) => void,
): () => void {
  if (Platform.OS !== "ios") return () => {};
  const mod = requireWatchConnectivity<any>();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const seen = new Set<string>();
  const handle = (payload: any, reply?: (r: any) => void) => {
    if (payload?.type !== "dmReply") return;
    // Checked per-reply so switching Messages off takes effect immediately.
    if (!watchFeatureEnabled("messages")) return reply?.({ ok: false });
    const valid = validateDMReply(payload, knownIds());
    if (!valid) return reply?.({ ok: false });
    const key = `${valid.conversationId}:${valid.text}:${payload.sentAt ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      onReply(valid);
    }
    reply?.({ ok: true });
  };

  const subs = [
    mod.watchEvents.addListener("message", handle),
    mod.watchEvents.addListener("user-info", (info: any) => handle(info)),
  ];
  return () => subs.forEach((s) => s?.remove?.());
}

/**
 * Push the host's live door counts to the wrist. No-op off iOS. Shares the
 * application-context slot with the member-facing payloads.
 *
 * Aggregates only — see `watch-door-payload`. Nothing here can locate anyone.
 */
export async function syncDoorToWatch(env: WatchDoorEnvelope): Promise<void> {
  if (!watchFeatureEnabled("door")) return;
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(env);
  lastDoorPayload = json;

  const mod = connectivityModule();
  if (!mod) return;
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ door: json });
    }
  } catch (err) {
    console.warn("[watch-bridge] door push failed", err);
  }
}

/**
 * Ring the watch. Deliberately NOT the application context: that slot is a
 * latest-wins snapshot shared by tickets and broadcasts, so a call parked there
 * would still be ringing on the next launch. A call is an event — `sendMessage`
 * when reachable, `transferUserInfo` as the queued fallback.
 */
export async function pushCallToWatch(call: WatchCallDTO): Promise<void> {
  if (!watchFeatureEnabled("calls")) return;
  if (Platform.OS !== "ios") return;
  const mod = connectivityModule();
  if (!mod) return;
  const body = { call: JSON.stringify(call) };
  try {
    if ((await isReachable(mod)) && typeof mod.sendMessage === "function") {
      mod.sendMessage(body, undefined, () => {
        // Reachability is a snapshot and can be stale by the time we send.
        mod.transferUserInfo?.(body);
      });
    } else {
      mod.transferUserInfo?.(body);
    }
  } catch (err) {
    console.warn("[watch-bridge] call push failed", err);
  }
}

/**
 * Stop the wrist ringing — answered on the phone, declined, or timed out.
 * Always best-effort on both transports: a missed clear leaves the watch
 * buzzing every 2.4s for a call that no longer exists.
 */
export async function clearCallOnWatch(callId: string): Promise<void> {
  if (Platform.OS !== "ios") return;
  const mod = connectivityModule();
  if (!mod) return;
  const body = { callEnded: callId };
  try {
    if ((await isReachable(mod)) && typeof mod.sendMessage === "function") {
      mod.sendMessage(body, undefined, () => mod.transferUserInfo?.(body));
    } else {
      mod.transferUserInfo?.(body);
    }
  } catch (err) {
    console.warn("[watch-bridge] call clear failed", err);
  }
}

/**
 * Listen for the wearer's accept/decline. Returns an unsubscribe fn.
 *
 * Both transports are handled: `message` for the live case, `user-info` for a
 * decision made while the phone was briefly unreachable. Decisions are
 * de-duplicated by call id, because a queued action can arrive after the live
 * one already landed.
 */
export function registerWatchCallHandler(
  onAction: (callId: string, action: WatchCallAction) => void,
): () => void {
  if (Platform.OS !== "ios") return () => {};
  const mod = requireWatchConnectivity<any>();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const seen = new Set<string>();
  const handle = (payload: any, reply?: (r: any) => void) => {
    // Checked per-decision, not at registration: flipping the switch off must
    // take effect immediately, without waiting for this listener to remount.
    if (!watchFeatureEnabled("calls")) return reply?.({ ok: true });
    if (payload?.type === "callAction" && typeof payload.callId === "string") {
      const key = `${payload.callId}:${payload.action}`;
      if (!seen.has(key)) {
        seen.add(key);
        onAction(payload.callId, payload.action === "accept" ? "accept" : "decline");
      }
    }
    reply?.({ ok: true });
  };

  const subs = [
    mod.watchEvents.addListener("message", handle),
    mod.watchEvents.addListener("user-info", (info: any) => handle(info)),
  ];
  return () => subs.forEach((s) => s?.remove?.());
}

export interface WatchStatus {
  paired: boolean;
  appInstalled: boolean;
  reachable: boolean;
}

/**
 * Is there actually a watch to talk to? Used by the settings screen so the
 * switches are never presented as if they were doing something when no watch
 * is paired. All three degrade to false rather than throwing.
 */
export async function getWatchStatus(): Promise<WatchStatus> {
  const off = { paired: false, appInstalled: false, reachable: false };
  if (Platform.OS !== "ios") return off;
  const mod = requireWatchConnectivity<any>();
  if (!mod) return off;
  const probe = async (fn: unknown): Promise<boolean> =>
    typeof fn === "function"
      ? await (fn as () => Promise<boolean>)().catch(() => false)
      : false;
  const [paired, appInstalled, reachable] = await Promise.all([
    probe(mod.getIsPaired),
    probe(mod.getIsWatchAppInstalled),
    probe(mod.getReachability),
  ]);
  return { paired, appInstalled, reachable };
}

/**
 * The one write path for the watch feature switches.
 *
 * Turning a feature off is not just "stop pushing": whatever was last pushed is
 * cached in the watch's own App Group and would sit there indefinitely. So a
 * disable sends the empty envelope that clears it, and a re-enable is left to
 * the next natural sync (the ticket/broadcast hooks push on their own poll).
 */
export async function setWatchFeature(
  key: WatchFeatureKey,
  value: boolean,
): Promise<void> {
  useWatchSettingsStore.getState().set(key, value);
  if (value) return;

  const syncedAt = Math.floor(Date.now() / 1000);
  const master = key === "enabled";
  if (master || key === "tickets") await pushTickets({ tickets: [], syncedAt });
  if (master || key === "broadcasts")
    await pushBroadcasts({ broadcasts: [], syncedAt });
  if (master || key === "messages") await pushDMs({ dms: [], syncedAt });
  if (master || key === "door") {
    lastDoorPayload = JSON.stringify({ door: null, syncedAt });
    const mod = connectivityModule();
    if (mod) pushMergedContext(mod);
  }
  // Empty id = clear whatever is ringing (`CallStore.clear(callId: nil)`).
  if (master || key === "calls") await clearCallOnWatch("");
}

type EnvelopeGetters = {
  tickets?: () => WatchTicketEnvelope | null;
  broadcasts?: () => WatchBroadcastEnvelope | null;
  dms?: () => WatchDMEnvelope | null;
};

/**
 * Register a responder so the watch's on-demand requests are answered with the
 * freshest snapshots. The watch sends `{ type: "requestTickets" }` or
 * `{ type: "requestBroadcasts" }`; we reply by re-pushing the merged context.
 * Returns an unsubscribe fn. Safe to call with getters that may return null
 * before data has loaded.
 */
export function registerWatchRequestHandler(getters: EnvelopeGetters): () => void {
  if (Platform.OS !== "ios") return () => {};
  const mod = requireWatchConnectivity<any>();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const sub = mod.watchEvents.addListener(
    "message",
    (message: any, reply: any) => {
      // A request from the wrist must not resurrect a feature the member
      // switched off — the retained (emptied) payload stands.
      if (message?.type === "requestTickets" && watchFeatureEnabled("tickets")) {
        const env = getters.tickets?.();
        if (env) lastTicketsPayload = JSON.stringify(env);
      } else if (
        message?.type === "requestBroadcasts" &&
        watchFeatureEnabled("broadcasts")
      ) {
        const env = getters.broadcasts?.();
        if (env) lastBroadcastsPayload = JSON.stringify(env);
      } else if (
        message?.type === "requestDMs" &&
        watchFeatureEnabled("messages")
      ) {
        const env = getters.dms?.();
        if (env) lastDMsPayload = JSON.stringify(env);
      }
      try {
        pushMergedContext(mod);
      } catch {
        /* ignore */
      }
      reply?.({ ok: true });
    },
  );
  return () => sub?.remove?.();
}
