/**
 * Phone → Watch bridge. Two transports, both best-effort and crash-safe:
 *
 *  1. WCSession.updateApplicationContext (via react-native-watch-connectivity) —
 *     latest-wins coalesced snapshot of the member's current state. There is a
 *     SINGLE application-context slot, so tickets and broadcasts are merged into
 *     one dictionary (`{ payload, broadcasts }`); pushing one never wipes the
 *     other (see `pushMergedContext`). transferUserInfo is also used for prompt
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

const IPHONE_APP_GROUP = "group.com.dvnt.app";
const TICKETS_STORAGE_KEY = "dvnt.tickets.envelope";
const BROADCASTS_STORAGE_KEY = "dvnt.broadcasts.envelope";

let warnedConnectivity = false;
let warnedStorage = false;

// The single application-context slot is shared; retain each half so a push of
// one never drops the other (the two sync hooks fire independently).
let lastTicketsPayload: string | null = null;
let lastBroadcastsPayload: string | null = null;

/** Lazy, optional require so a missing native module degrades gracefully. */
function optionalRequire<T = any>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    return null;
  }
}

function connectivityModule(): any | null {
  const mod = optionalRequire("react-native-watch-connectivity");
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
  if (Object.keys(ctx).length === 0) return;
  try {
    mod.updateApplicationContext(ctx);
  } catch (err) {
    console.warn("[watch-bridge] updateApplicationContext failed", err);
  }
}

function writeAppGroup(key: string, json: string): void {
  const mod = optionalRequire("@bacons/apple-targets");
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

type EnvelopeGetters = {
  tickets?: () => WatchTicketEnvelope | null;
  broadcasts?: () => WatchBroadcastEnvelope | null;
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
  const mod = optionalRequire("react-native-watch-connectivity");
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const sub = mod.watchEvents.addListener(
    "message",
    (message: any, reply: any) => {
      if (message?.type === "requestTickets") {
        const env = getters.tickets?.();
        if (env) lastTicketsPayload = JSON.stringify(env);
      } else if (message?.type === "requestBroadcasts") {
        const env = getters.broadcasts?.();
        if (env) lastBroadcastsPayload = JSON.stringify(env);
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
