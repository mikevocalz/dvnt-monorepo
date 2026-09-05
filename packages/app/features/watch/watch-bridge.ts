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

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import type { WatchTicketEnvelope } from "./watch-payload";
import type { WatchBroadcastEnvelope } from "./watch-broadcast-payload";
import type { WatchCallAction, WatchCallDTO } from "./watch-call-payload";
import type { WatchDoorEnvelope } from "./watch-door-payload";
import {
  type WatchDMEnvelope,
} from "./watch-dm-payload";
import {
  useWatchSettingsStore,
  watchFeatureEnabled,
  type WatchFeatureKey,
} from "./watch-settings-store";

import { validateSendCommand, type WatchSendCommand, type WatchCommandResult, type WatchThreadPage } from "./contracts/v2";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useWatchSessionStore } from "./watch-session-store";

function unsubscribeWatch(sub: unknown): void {
  if (typeof sub === "function") sub();
  else if (sub && typeof sub === "object" && "remove" in sub && typeof sub.remove === "function") sub.remove();
}

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
let lastEventsPayload: string | null = null;
let lastCallDirectoryPayload: string | null = null;
let lastActiveCallPayload: string | null = null;
let lastActiveCallSignature = "";

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

/** Generation travels with every snapshot, including delayed user-info. */
function sessionPayload(): string {
  return JSON.stringify({ protocol: 2, accountGen: useWatchSessionStore.getState().selectAccount(useAuthStore.getState().user?.id ?? null), syncedAt: Date.now() / 1000 });
}
function scopedEnvelope<T extends object>(env: T): T & { protocol: number; accountGen: string } {
  return { protocol: 2, accountGen: useWatchSessionStore.getState().selectAccount(useAuthStore.getState().user?.id ?? null), ...env };
}

/** Push the merged latest-wins snapshot (tickets + broadcasts) in one context. */
function pushMergedContext(mod: any): void {
  if (typeof mod.updateApplicationContext !== "function") return;
  const ctx: Record<string, string> = { session: sessionPayload() };
  if (lastTicketsPayload != null) ctx.payload = lastTicketsPayload;
  if (lastBroadcastsPayload != null) ctx.broadcasts = lastBroadcastsPayload;
  if (lastDMsPayload != null) ctx.dms = lastDMsPayload;
  if (lastDoorPayload != null) ctx.door = lastDoorPayload;
  if (lastEventsPayload != null) ctx.events = lastEventsPayload;
  if (lastCallDirectoryPayload != null) ctx.callDirectory = lastCallDirectoryPayload;
  if (lastActiveCallPayload != null) ctx.activeCall = lastActiveCallPayload;
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
 * Sync the current ticket set to the wrist.
 *
 * iOS: WCSession application context + the iPhone App Group for the widget.
 * Android: a DataClient item on /tickets for the Wear OS app. Both rails carry
 * the byte-identical envelope, which is why watch-payload.ts is platform-free.
 */
export async function syncTicketsToWatch(
  env: WatchTicketEnvelope,
): Promise<void> {
  if (!watchFeatureEnabled("tickets") || env.protocol !== 2 || env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  await pushTickets(env);
}

// ---------------------------------------------------------------- Wear OS

interface WearBridge {
  broadcastEvent(payloadJson: string): Promise<boolean>;
  syncContext(payloadJson: string, syncedAt: number): Promise<boolean>;
  sendResponse(nodeId: string, requestId: string, payloadJson: string): Promise<boolean>;
  syncTickets(payloadJson: string, syncedAt: number): Promise<boolean>;
  isWearAppAvailable(): Promise<boolean>;
}

/** Absent on iOS, in Expo Go, and in any build predating the wear plugin. */
function wearBridge(): WearBridge | null {
  if (Platform.OS !== "android") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((NativeModules as any)?.DVNTWearBridge as WearBridge) ?? null;
}

function commandTransport(): any | null {
  if (Platform.OS === "ios") return requireWatchConnectivity<any>();
  const native = wearBridge();
  if (!native) return null;
  const emitter = new NativeEventEmitter(NativeModules.DVNTWearBridge);
  return { watchEvents: { addListener: (event: string, callback: (payload: unknown, reply?: (body: unknown) => void) => void) => {
    if (event !== "message") return () => {};
    const sub = emitter.addListener("DVNTWearMessage", (event: { nodeId: string; requestId: string; payload: string }) => {
      try {
        callback(JSON.parse(event.payload), (body) => {
          void native.sendResponse(event.nodeId, event.requestId, JSON.stringify(body)).catch(() => {});
        });
      } catch { /* Malformed transport payload has no authorized command. */ }
    });
    return () => sub.remove();
  } } };
}

async function pushWearContext(): Promise<void> {
  const native = wearBridge();
  if (!native?.syncContext) return;
  const context: Record<string, string> = { session: sessionPayload() };
  if (lastTicketsPayload) context.payload = lastTicketsPayload;
  if (lastBroadcastsPayload) context.broadcasts = lastBroadcastsPayload;
  if (lastDMsPayload) context.dms = lastDMsPayload;
  if (lastDoorPayload) context.door = lastDoorPayload;
  if (lastEventsPayload) context.events = lastEventsPayload;
  if (lastCallDirectoryPayload) context.callDirectory = lastCallDirectoryPayload;
  if (lastActiveCallPayload) context.activeCall = lastActiveCallPayload;
  await native.syncContext(JSON.stringify(context), Date.now());
}

/**
 * The Android rail. Same envelope as iOS — the Wear app decodes the identical
 * JSON the Apple Watch does, which is why `watch-payload.ts` is platform-free.
 *
 * Asks CapabilityClient first rather than writing unconditionally: a DataItem
 * put with no watch present is wasted work on every ticket refresh, on the
 * overwhelming majority of installs that have no watch at all.
 */
async function pushTicketsToWear(env: WatchTicketEnvelope): Promise<void> {
  const mod = wearBridge();
  if (!mod) return;
  try {
    const json = JSON.stringify(scopedEnvelope(env));
    lastTicketsPayload = json;
    // syncedAt is seconds on the wire (the Apple Watch reads it that way);
    // the Data Layer wants millis, and it doubles as the field that makes two
    // otherwise-identical payloads differ so the listener actually fires.
    await mod.syncTickets(json, Math.round((env.syncedAt || Date.now() / 1000) * 1000));
    await pushWearContext();
  } catch (err) {
    console.warn("[watch-bridge] wear ticket push failed", err);
  }
}

/** Unguarded push — the switch is checked by callers, so disabling a feature
 *  can still send the empty envelope that clears the wrist. */
async function pushTickets(env: WatchTicketEnvelope): Promise<void> {
  if (Platform.OS === "android") {
    await pushTicketsToWear(env);
    return;
  }
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(scopedEnvelope(env));
  lastTicketsPayload = json;
  writeAppGroup(TICKETS_STORAGE_KEY, json);

  const mod = connectivityModule();
  if (!mod) return;
  const session = sessionPayload();
  try {
    pushMergedContext(mod);
    // If reachable, also queue a prompt snapshot so a `scanned` flip arrives fast
    // (the watch fires a success haptic on the used-state transition).
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ session, payload: json });
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
  if (!watchFeatureEnabled("broadcasts") || env.protocol !== 2 || env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  await pushBroadcasts(env);
}

/** Unguarded push — see `pushTickets`. */
async function pushBroadcasts(env: WatchBroadcastEnvelope): Promise<void> {
  if (Platform.OS === "android") { lastBroadcastsPayload = JSON.stringify(scopedEnvelope(env)); await pushWearContext(); return; }
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(scopedEnvelope(env));
  lastBroadcastsPayload = json;
  writeAppGroup(BROADCASTS_STORAGE_KEY, json);

  const mod = connectivityModule();
  if (!mod) return;
  const session = sessionPayload();
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ session, broadcasts: json });
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
  if (!watchFeatureEnabled("messages") || env.protocol !== 2 || env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  await pushDMs(env);
}

/** Unguarded push — see `pushTickets`. */
async function pushDMs(env: WatchDMEnvelope): Promise<void> {
  if (env.protocol !== 2 || env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  if (Platform.OS === "android") { lastDMsPayload = JSON.stringify(env); await pushWearContext(); return; }
  if (Platform.OS !== "ios") return;
  const json = JSON.stringify(env);
  lastDMsPayload = json;
  // Deliberately NOT written to the iPhone App Group like tickets/broadcasts:
  // that copy exists for the iPhone widget, and no widget shows DMs. Message
  // previews sitting in a container nothing reads is footprint for nothing.

  const mod = connectivityModule();
  if (!mod) return;
  const session = sessionPayload();
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ session, dms: json });
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
  onReply: (reply: WatchSendCommand) => Promise<string>,
): () => void {
  const mod = commandTransport();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};
  const inFlight = new Map<string, Promise<WatchCommandResult>>();
  const handle = async (payload: any, reply?: (r: any) => void) => {
    if (payload?.type !== "dmReply") return;
    const { accountGen } = useWatchSessionStore.getState();
    const valid = watchFeatureEnabled("messages")
      ? validateSendCommand(payload, accountGen, knownIds()) : null;
    if (!valid) { reply?.({ ok: false, error: "Message expired or unavailable. Sync and retry." }); return; }
    let pending = inFlight.get(valid.operationId);
    if (!pending) {
      pending = onReply(valid).then((serverId): WatchCommandResult => ({
        protocol: 2, accountGen, operationId: valid.operationId, status: "sent", serverId,
      })).catch((): WatchCommandResult => ({
        protocol: 2, accountGen, operationId: valid.operationId, status: "failed",
        error: "Couldn’t send. Retry with your iPhone connected.",
      }));
      inFlight.set(valid.operationId, pending);
    }
    const result = await pending;
    inFlight.delete(valid.operationId);
    if (useWatchSessionStore.getState().accountGen !== accountGen) return;
    const body = { commandResult: JSON.stringify(result) };
    reply?.(body);
    // Backend operation_id reconciles a retry after either process dies.
    mod.transferUserInfo?.(body);
  };
  const subs = [
    mod.watchEvents.addListener("message", handle),
    mod.watchEvents.addListener("user-info", (items: unknown[]) => {
      for (const item of items) void handle(item);
    }),
  ];
  return () => subs.forEach(unsubscribeWatch);
}

/** Live refresh of recently opened threads; page carries its own account fence. */
export async function pushWatchThreadPage(page: WatchThreadPage): Promise<void> {
  if (!watchFeatureEnabled("messages") || page.accountGen !== useWatchSessionStore.getState().accountGen) return;
  const body = { session: sessionPayload(), threadPage: JSON.stringify(page) };
  if (Platform.OS === "ios") {
    const mod = connectivityModule();
    if (mod && await isReachable(mod)) mod.sendMessage?.(body, undefined, () => {});
  } else if (Platform.OS === "android") {
    await wearBridge()?.broadcastEvent?.(JSON.stringify(body)).catch(() => false);
  }
}

export function registerWatchThreadActionHandler(
  perform: (command: { action: "read" | "reaction"; conversationId: string; messageId?: string; emoji?: string; desiredPresent?: boolean }) => Promise<void>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type !== "threadAction") return;
    const accountGen = useWatchSessionStore.getState().accountGen;
    const now = Date.now() / 1000;
    if (!watchFeatureEnabled("messages") || raw.protocol !== 2 || !accountGen || raw.accountGen !== accountGen ||
        !["read", "reaction"].includes(raw.action) || typeof raw.conversationId !== "string" ||
        !Number.isFinite(raw.issuedAt) || !Number.isFinite(raw.expiresAt) || raw.expiresAt <= now ||
        raw.issuedAt > now + 5 || raw.expiresAt <= raw.issuedAt || raw.expiresAt - raw.issuedAt > 60 ||
        (raw.action === "reaction" && (typeof raw.messageId !== "string" || !["😂", "😢", "😊", "😈", "🥵", "💝", "❤️"].includes(raw.emoji) || typeof raw.desiredPresent !== "boolean"))) {
      reply?.({ ok: false, error: "Action unavailable. Sync and retry." }); return;
    }
    try {
      await perform(raw);
      if (accountGen === useWatchSessionStore.getState().accountGen) reply?.({ session: sessionPayload(), ok: true });
    } catch { reply?.({ ok: false, error: "Couldn’t update message. Retry with your phone connected." }); }
  });
  return () => unsubscribeWatch(sub);
}

export function registerWatchThreadHandler(
  load: (conversationId: string, olderCursor?: { createdAt: string; id: string }, retainedMessageIds?: string[]) => Promise<WatchThreadPage>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type !== "threadPage") return;
    const accountGen = useWatchSessionStore.getState().accountGen;
    if (!watchFeatureEnabled("messages") || raw.protocol !== 2 || raw.accountGen !== accountGen || typeof raw.conversationId !== "string") {
      reply?.({ ok: false, error: "Conversation unavailable. Sync with your iPhone." }); return;
    }
    try {
      const retained = Array.isArray(raw.retainedMessageIds)
        ? [...new Set(raw.retainedMessageIds.filter((id: unknown): id is string => typeof id === "string" && /^\d{1,20}$/.test(id)))].slice(0, 250) as string[] : [];
      const page = await load(raw.conversationId, raw.olderCursor, retained);
      if (accountGen !== useWatchSessionStore.getState().accountGen) return;
      reply?.({ session: sessionPayload(), threadPage: JSON.stringify(page) });
    } catch { reply?.({ ok: false, error: "Couldn’t load messages. Open DVNT on your iPhone and retry." }); }
  });
  return () => unsubscribeWatch(sub);
}

/**
 * Push the host's live door counts to the wrist. No-op off iOS. Shares the
 * application-context slot with the member-facing payloads.
 *
 * Aggregates only — see `watch-door-payload`. Nothing here can locate anyone.
 */
export function registerWatchDoorHandler(refresh: () => Promise<void>): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", (raw: any, reply: any) => {
    if (raw?.type !== "requestDoor") return;
    if (watchFeatureEnabled("door")) void refresh().catch(() => {});
    reply?.({ session: sessionPayload(), ...(lastDoorPayload ? { door: lastDoorPayload } : {}) });
  });
  return () => unsubscribeWatch(sub);
}

export async function syncDoorToWatch(env: WatchDoorEnvelope): Promise<void> {
  if (!watchFeatureEnabled("door") || env.protocol !== 2 || env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  const json = JSON.stringify(env);
  lastDoorPayload = json;
  if (Platform.OS === "android") { await pushWearContext(); return; }
  if (Platform.OS !== "ios") return;

  const mod = connectivityModule();
  if (!mod) return;
  const session = sessionPayload();
  try {
    pushMergedContext(mod);
    if ((await isReachable(mod)) && typeof mod.transferUserInfo === "function") {
      mod.transferUserInfo({ session, door: json });
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
  const accountGen = useWatchSessionStore.getState().selectAccount(useAuthStore.getState().user?.id ?? null);
  const body = { session: sessionPayload(), call: JSON.stringify({ ...call, protocol: 2, accountGen }) };
  if (Platform.OS === "android") { await wearBridge()?.broadcastEvent?.(JSON.stringify(body)).catch(() => false); return; }
  if (Platform.OS !== "ios") return;
  const mod = connectivityModule();
  if (!mod) return;
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
  const body = { session: sessionPayload(), callEnded: callId };
  if (Platform.OS === "android") { await wearBridge()?.broadcastEvent?.(JSON.stringify(body)).catch(() => false); return; }
  if (Platform.OS !== "ios") return;
  const mod = connectivityModule();
  if (!mod) return;
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
 * decision made while the phone was briefly unreachable. Decisions share the authoritative result for a given operation, including
 * concurrent live and queued delivery.
 */
export function registerWatchCallHandler(
  onAction: (callId: string, action: WatchCallAction) => boolean | Promise<boolean>,
): () => void {
  const mod = commandTransport();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const pending = new Map<string, { expiresAt: number; result: Promise<boolean> }>();
  const handle = async (payload: any, reply?: (r: any) => void) => {
    if (payload?.type !== "callAction") return;
    const now = Date.now() / 1000;
    const generation = useWatchSessionStore.getState().accountGen;
    if (payload.protocol !== 2 || payload.accountGen !== generation ||
        payload.expectedStatus !== "ringing" || typeof payload.operationId !== "string" ||
        typeof payload.callId !== "string" || !payload.callId ||
        !["accept", "accept_audio_only", "decline"].includes(payload.action) ||
        !Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt) ||
        payload.issuedAt > now + 5 || payload.expiresAt <= now ||
        payload.expiresAt - payload.issuedAt > 30 || !watchFeatureEnabled("calls")) return reply?.({ ok: false });
    for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
    const key = `${generation}:${payload.operationId}:${payload.callId}:${payload.action}`;
    let entry = pending.get(key);
    if (!entry) {
      const result = Promise.resolve().then(() => onAction(payload.callId, payload.action)).catch(() => false);
      entry = { expiresAt: payload.expiresAt, result };
      pending.set(key, entry);
    }
    const ok = await entry.result;
    if (generation !== useWatchSessionStore.getState().accountGen) return;
    reply?.({ ok: ok === true });
  };

  const subs = [
    mod.watchEvents.addListener("message", handle),
    mod.watchEvents.addListener("user-info", (items: any[]) => { for (const info of items) void handle(info); }),
  ];
  return () => subs.forEach(unsubscribeWatch);
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
  if (Platform.OS === "android") {
    const detected = await wearBridge()?.isWearAppAvailable().catch(() => false) ?? false;
    return { paired: detected, appInstalled: detected, reachable: false };
  }
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
  if (master || key === "messages") await pushDMs({ protocol: 2, accountGen: useWatchSessionStore.getState().accountGen, dms: [], syncedAt });
  if (master || key === "door") {
    lastDoorPayload = JSON.stringify({ protocol: 2, accountGen: useWatchSessionStore.getState().accountGen, status: "ready", door: null, syncedAt });
    if (Platform.OS === "android") await pushWearContext();
    const mod = connectivityModule();
    if (mod) pushMergedContext(mod);
  }
  // Empty id = clear whatever is ringing (`CallStore.clear(callId: nil)`).
  if (master || key === "calls") await clearCallOnWatch("");
}

export async function clearWatchAccount(accountGen: string): Promise<void> {
  const syncedAt = Date.now() / 1000;
  lastTicketsPayload = JSON.stringify({ protocol: 2, accountGen, tickets: [], syncedAt });
  lastBroadcastsPayload = JSON.stringify({ broadcasts: [], syncedAt });
  lastDMsPayload = JSON.stringify({ protocol: 2, accountGen, dms: [], syncedAt });
  lastDoorPayload = JSON.stringify({ protocol: 2, accountGen, status: "ready", door: null, syncedAt });
  lastEventsPayload = JSON.stringify({ protocol: 2, accountGen, events: [], syncedAt, status: "ready" });
  lastCallDirectoryPayload = JSON.stringify({ protocol: 2, accountGen, people: [], recents: [], syncedAt });
  lastActiveCallPayload = null; lastActiveCallSignature = "";
  if (Platform.OS === "android") {
    try { await wearBridge()?.syncTickets(lastTicketsPayload, Math.round(syncedAt * 1000)); } catch {}
    await pushWearContext(); return;
  }
  if (Platform.OS !== "ios") return;
  writeAppGroup(TICKETS_STORAGE_KEY, lastTicketsPayload);
  writeAppGroup(BROADCASTS_STORAGE_KEY, lastBroadcastsPayload);
  const mod = connectivityModule();
  if (mod) pushMergedContext(mod);
  await clearCallOnWatch("");
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
  const mod = commandTransport();
  if (!mod || typeof mod.watchEvents?.addListener !== "function") return () => {};

  const sub = mod.watchEvents.addListener(
    "message",
    (message: any, reply: any) => {
      if (message?.type === "syncRequest" && getters.tickets) {
        void pushWearContext(); reply?.({ ok: true }); return;
      }
      const handled = (message?.type === "requestTickets" && getters.tickets) ||
        (message?.type === "requestBroadcasts" && getters.broadcasts) ||
        (message?.type === "requestDMs" && getters.dms);
      if (!handled) return;
      // A request from the wrist must not resurrect a feature the member
      // switched off — the retained (emptied) payload stands.
      if (message?.type === "requestTickets" && watchFeatureEnabled("tickets")) {
        const env = getters.tickets?.();
        if (env?.protocol === 2 && env.accountGen === useWatchSessionStore.getState().accountGen) lastTicketsPayload = JSON.stringify(scopedEnvelope(env));
      } else if (
        message?.type === "requestBroadcasts" &&
        watchFeatureEnabled("broadcasts")
      ) {
        const env = getters.broadcasts?.();
        if (env?.protocol === 2 && env.accountGen === useWatchSessionStore.getState().accountGen) lastBroadcastsPayload = JSON.stringify(scopedEnvelope(env));
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
      reply?.({ session: sessionPayload(), ...(lastTicketsPayload ? { payload: lastTicketsPayload } : {}), ...(lastBroadcastsPayload ? { broadcasts: lastBroadcastsPayload } : {}), ...(lastDMsPayload ? { dms: lastDMsPayload } : {}) });
    },
  );
  return () => unsubscribeWatch(sub);
}


export async function syncEventsToWatch(env: import("./watch-event-payload").WatchEventEnvelope): Promise<void> {
  if (env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  lastEventsPayload = JSON.stringify(env);
  if (Platform.OS === "android") { await pushWearContext(); return; }
  if (Platform.OS === "ios") { const mod = connectivityModule(); if (mod) pushMergedContext(mod); }
}
export function registerWatchEventHandler(
  perform: (raw: unknown) => Promise<import("./watch-event-payload").WatchEventResult>,
  refresh: () => Promise<void>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type === "requestEvents") {
      void refresh();
      reply?.({ session: sessionPayload(), ...(lastEventsPayload ? { events: lastEventsPayload } : {}) });
    } else if (raw?.type === "eventAction") {
      const accountGen = useWatchSessionStore.getState().accountGen;
      const result = await perform(raw);
      if (accountGen === useWatchSessionStore.getState().accountGen) reply?.({ session: sessionPayload(), eventResult: JSON.stringify(result) });
    }
  });
  return () => unsubscribeWatch(sub);
}

// Bind before React effects: another feature can push during an auth transition.
// Clear retained domains synchronously before any async transport work begins.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id === previous.user?.id) return;
  const accountGen = useWatchSessionStore.getState().selectAccount(state.user?.id ?? null);
  void clearWatchAccount(accountGen).catch(() => {});
});

export async function syncCallDirectoryToWatch(env: import("./watch-call-directory").WatchCallDirectory): Promise<void> {
  if (env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  lastCallDirectoryPayload = JSON.stringify(env);
  if (Platform.OS === "android") { await pushWearContext(); return; }
  if (Platform.OS === "ios") { const mod = connectivityModule(); if (mod) pushMergedContext(mod); }
}
export function registerWatchCallDirectoryHandler(
  perform: (raw: unknown) => Promise<import("./watch-call-directory").WatchCallDirectoryResult>,
  refresh: () => Promise<void>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type === "requestCallDirectory") {
      void refresh();
      reply?.({ session: sessionPayload(), ...(lastCallDirectoryPayload ? { callDirectory: lastCallDirectoryPayload } : {}) });
    } else if (raw?.type === "callDirectoryAction") {
      const accountGen = useWatchSessionStore.getState().accountGen;
      const result = await perform(raw);
      if (accountGen === useWatchSessionStore.getState().accountGen) reply?.({ session: sessionPayload(), callDirectoryResult: JSON.stringify(result) });
    }
  });
  return () => unsubscribeWatch(sub);
}

export function registerWatchVenueHandler(
  perform: (raw: unknown) => Promise<import("./watch-venue-actions").WatchVenueResult>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type !== "venueAction") return;
    const accountGen = useWatchSessionStore.getState().accountGen;
    const result = await perform(raw);
    if (accountGen === useWatchSessionStore.getState().accountGen) reply?.({ session: sessionPayload(), venueResult: JSON.stringify(result) });
  });
  return () => unsubscribeWatch(sub);
}

export async function pushActiveCall(env: import("./watch-active-call").WatchActiveCallEnvelope): Promise<void> {
  if (env.accountGen !== useWatchSessionStore.getState().accountGen) return;
  const json = JSON.stringify(env);
  const signature = JSON.stringify([env.accountGen, env.roomId, env.phase, env.muted, env.canMute]);
  const changed = signature !== lastActiveCallSignature;
  lastActiveCallSignature = signature; lastActiveCallPayload = json;
  if (Platform.OS === "android") {
    if (changed) await pushWearContext();
    await wearBridge()?.broadcastEvent?.(JSON.stringify({ session: sessionPayload(), activeCall: json })).catch(() => false); return;
  }
  if (Platform.OS !== "ios") return;
  const mod = connectivityModule();
  if (!mod) return;
  const session = sessionPayload();
  if (changed) pushMergedContext(mod);
  // Heartbeats are small live events; avoid rewriting every retained snapshot.
  if (await isReachable(mod)) mod.sendMessage?.({ session, activeCall: json }, undefined, () => {});
}
export function registerWatchActiveCallHandler(
  perform: (raw: unknown) => Promise<import("./watch-active-call").WatchActiveCallResult>,
): () => void {
  const mod = commandTransport();
  if (!mod?.watchEvents?.addListener) return () => {};
  const sub = mod.watchEvents.addListener("message", async (raw: any, reply: any) => {
    if (raw?.type !== "activeCallAction") return;
    const accountGen = useWatchSessionStore.getState().accountGen;
    const result = await perform(raw);
    if (accountGen === useWatchSessionStore.getState().accountGen) reply?.({ session: sessionPayload(), activeCallResult: JSON.stringify(result) });
  });
  return () => unsubscribeWatch(sub);
}
