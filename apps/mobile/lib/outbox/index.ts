/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DVNT OUTBOX — durable offline mutation queue (WS-12)               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * MMKV-persisted (own instance id "dvnt-outbox") Zustand FIFO of pending
 * mutations, drained automatically when connectivity returns (connectivity
 * store phase→online) and when the app foregrounds (AppState "active",
 * same pattern as lib/query-focus-manager.ts). Web gets the same triggers
 * via navigator.onLine wiring inside connectivity-store.
 *
 * USAGE (feature code):
 *   1. Register an executor once at module scope:
 *        registerOutboxExecutor("bookmark.toggle", async (entry) => {
 *          await invokeEdge("bookmark-toggle", {
 *            ...entry.payload,
 *            idempotency_key: entry.idempotencyKey,   // ← REQUIRED, see below
 *          });
 *        });
 *   2. Enqueue instead of firing when offline (or always — drain is
 *      immediate when online):
 *        enqueueOutboxMutation({
 *          mutationType: "bookmark.toggle",
 *          entityType: "post",
 *          entityRef: postId,
 *          payload: { post_id: postId, on: true },    // IDs/refs ONLY
 *        });
 *
 * SERVER CONTRACT — executors MUST send the entry's idempotencyKey as the
 * request-body field `idempotency_key` (snake_case, body — not a header).
 * The server dedupes via the `client_mutations` table (idempotency_key
 * UNIQUE; migration owned by the schema workstream, modeled on
 * stripe_events). A replayed key returns the original result, so
 * crash-recovery requeues (see store.ts merge) are safe.
 *
 * PAYLOAD LAW — payload carries asset IDs / refs / small scalars only.
 * NEVER base64, never file contents. Media goes through the upload
 * pipeline; the outbox queues the *reference*.
 *
 * ── MONEY LAW ─────────────────────────────────────────────────────────
 * Paid checkout, refunds and payouts NEVER enqueue. A durable queue that
 * replays money mutations minutes/hours later — after the user walked
 * away, after inventory moved, after a card was retried by hand — is a
 * double-charge machine. Money paths stay synchronous, online-only, and
 * fail loudly in the UI. Enforced at registration: mutationTypes matching
 * /checkout|refund|payout/ throw in dev (refused + Sentry-breadcrumbed in
 * prod). See MONEY_DENYLIST in ./drain.ts.
 * ──────────────────────────────────────────────────────────────────────
 */

import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import { createMMKV } from "react-native-mmkv";
import type { StateStorage } from "zustand/middleware";
import {
  initConnectivity,
  isOnline,
  useConnectivityStore,
} from "@/lib/stores/connectivity-store";
import { createOutboxStore } from "./store";
import { drainOutbox } from "./drain";

export {
  registerOutboxExecutor,
  unregisterOutboxExecutor,
  drainOutbox,
  MONEY_DENYLIST,
} from "./drain";
export { OutboxTerminalError, isTerminalOutboxError } from "./types";
export type {
  OutboxEntry,
  OutboxExecutor,
  OutboxStatus,
  EnqueueInput,
  OutboxPayloadValue,
} from "./types";
export type { OutboxState, OutboxStore } from "./store";

// ─── Storage: own MMKV instance, defensive init (app-trace pattern) ─────────
// Falls back to a volatile in-memory map if MMKV can't initialize — the
// queue loses durability but the app never crashes at module eval.

function createOutboxStorage(): StateStorage {
  try {
    const mmkv = createMMKV({ id: "dvnt-outbox" });
    return {
      getItem: (name) => mmkv.getString(name) ?? null,
      setItem: (name, value) => mmkv.set(name, value),
      removeItem: (name) => mmkv.remove(name),
    };
  } catch (e) {
    console.warn("[Outbox] MMKV unavailable — falling back to memory:", e);
    const mem = new Map<string, string>();
    return {
      getItem: (name) => mem.get(name) ?? null,
      setItem: (name, value) => void mem.set(name, value),
      removeItem: (name) => void mem.delete(name),
    };
  }
}

export const useOutboxStore = createOutboxStore(createOutboxStorage());

// ─── Public API ─────────────────────────────────────────────────────────────

import type { EnqueueInput, OutboxEntry } from "./types";

/**
 * Enqueue a mutation for durable delivery. Returns the created entry
 * (its idempotencyKey is minted here and never changes). If we're online
 * a drain kicks off immediately, so the common case is near-synchronous.
 */
export function enqueueOutboxMutation(input: EnqueueInput): OutboxEntry {
  const entry = useOutboxStore.getState().enqueue(input);
  if (isOnline()) void requestDrain();
  return entry;
}

// ─── Shared drain signal ────────────────────────────────────────────────────
// One subscriber set for every durable queue in the app: the outbox itself
// plus satellites like the offline-checkin scan queue (which stays a
// dedicated store per the WS-8 decision but drains on the SAME triggers).

type DrainListener = () => void | Promise<void>;
const drainListeners = new Set<DrainListener>();

/**
 * Register a callback fired on every drain trigger (connectivity→online,
 * app foreground, explicit requestDrain). Used by offline-checkin-store
 * to auto-flush pendingScans. Returns an unsubscribe fn.
 */
export function addOutboxDrainListener(listener: DrainListener): () => void {
  drainListeners.add(listener);
  return () => drainListeners.delete(listener);
}

let _retryTimer: ReturnType<typeof setTimeout> | null = null;

async function drainOwnQueue(): Promise<void> {
  const result = await drainOutbox(useOutboxStore, { isOnline });
  // Schedule a follow-up pass when the earliest backed-off entry is due.
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
  if (result.nextDueInMs !== null) {
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      void requestDrain();
    }, Math.max(result.nextDueInMs, 1_000));
  }
}

/** Fire a drain cycle now (no-op while offline). Safe to call anytime. */
export async function requestDrain(): Promise<void> {
  if (!isOnline()) return;
  await drainOwnQueue();
  for (const listener of drainListeners) {
    try {
      await listener();
    } catch (e) {
      console.warn("[Outbox] drain listener failed:", e);
    }
  }
}

// ─── Trigger wiring ─────────────────────────────────────────────────────────

let _initialized = false;

/**
 * Idempotent bootstrap — call once from the root layout (module scope,
 * next to initConnectivity()). Attaches:
 *   - connectivity-store subscriber: phase transition → "online" drains
 *   - AppState foreground (native only, per query-focus-manager pattern)
 * Never throws (same boot-hardening contract as initConnectivity).
 */
export function initOutboxDrain(): void {
  if (_initialized) return;
  _initialized = true;

  try {
    initConnectivity(); // idempotent — guarantees the store is live on web too

    useConnectivityStore.subscribe((state, prev) => {
      if (state.phase === "online" && prev.phase !== "online") {
        void requestDrain();
      }
    });

    if (Platform.OS !== "web") {
      AppState.addEventListener("change", (status: AppStateStatus) => {
        if (status === "active") void requestDrain();
      });
    }

    // Boot-time flush: anything persisted from a previous session drains
    // as soon as we know we're online (store hydration is synchronous).
    if (isOnline()) void requestDrain();
  } catch (e) {
    console.warn("[Outbox] initOutboxDrain failed (non-fatal):", e);
  }
}
