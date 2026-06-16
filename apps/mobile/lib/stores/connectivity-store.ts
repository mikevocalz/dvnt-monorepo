/**
 * Connectivity Store
 *
 * Single source of truth for "is the app online right now?" across every
 * screen + the React Query online manager + any mutation that needs a
 * net-check before firing. Wired to expo-network via a MODULE-SCOPED
 * subscription so we have exactly one listener for the whole app (React
 * tree rebuilds don't remount it).
 *
 * State shape is intentionally narrow so selectors stay fast:
 *
 *   phase      — "online" | "offline" | "reconnecting"
 *   isOnline   — convenience: phase === "online"
 *   isOffline  — convenience: phase === "offline"
 *   lastOnlineAt — timestamp for "you've been offline for X seconds"
 *   lastChangeAt — used to debounce UI surfaces (banner/toast)
 *
 * We expose `isOnline()` as a module-level synchronous getter so code
 * paths outside React (mutation onMutate / onError handlers, chat store,
 * etc.) can check connectivity without subscribing.
 */

import { create } from "zustand";

// expo-network is loaded defensively so that a missing/mismatched
// native module in the installed binary can't take down startup. On
// OTA-only deliveries, the native side of expo-network may not exist
// on the binary — static `import from "expo-network"` would resolve
// to an object with undefined exports in that case, and calling
// `addNetworkStateListener(...).remove` at module scope would throw
// a TypeError during Hermes module eval, crashing the app before
// React ever mounts. The dynamic require + null-guard pattern
// degrades gracefully: if expo-network isn't available, connectivity
// stays pinned to the optimistic "online" seed and nothing throws.
type NetworkState = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};
type NetworkSubscription = { remove?: () => void } | undefined | null;
type ExpoNetworkModule = {
  addNetworkStateListener?: (
    cb: (event: NetworkState) => void,
  ) => NetworkSubscription;
  getNetworkStateAsync?: () => Promise<NetworkState>;
};

let _expoNetwork: ExpoNetworkModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _expoNetwork = require("expo-network");
} catch (e) {
  console.warn(
    "[Connectivity] expo-network not available in this binary — running in optimistic-online mode",
  );
  _expoNetwork = null;
}

export type ConnectivityPhase = "online" | "offline" | "reconnecting";

interface ConnectivityState {
  phase: ConnectivityPhase;
  isOnline: boolean;
  isOffline: boolean;
  /** ms-epoch of the last time we transitioned into `online`. */
  lastOnlineAt: number | null;
  /** ms-epoch of the most recent phase change (used to debounce UI). */
  lastChangeAt: number;

  /** INTERNAL — used by the module-level listener to publish new state. */
  _setPhase: (next: ConnectivityPhase) => void;
}

// Start optimistic — assume online until proven otherwise. This avoids a
// spurious "offline" banner flash on cold start while the first
// expo-network query is still resolving.
const INITIAL_PHASE: ConnectivityPhase = "online";

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  phase: INITIAL_PHASE,
  isOnline: true,
  isOffline: false,
  lastOnlineAt: Date.now(),
  lastChangeAt: Date.now(),

  _setPhase: (next) => {
    const prev = get().phase;
    if (prev === next) return;
    const now = Date.now();
    set({
      phase: next,
      isOnline: next === "online",
      isOffline: next === "offline",
      lastChangeAt: now,
      lastOnlineAt: next === "online" ? now : get().lastOnlineAt,
    });
  },
}));

// ─── Module-scoped subscription ─────────────────────────────────────────────
// Single source of truth — mounted once at import. Never remounts on React
// tree changes, so there's never more than one native listener active.

let _subscribed = false;
let _unsubscribe: (() => void) | null = null;

/**
 * The "offline flap" debounce. Mobile networks briefly drop during
 * handoff (WiFi ↔ cellular, elevator, tunnel). Flipping the UI every
 * time is jittery and noisy. We require the offline signal to persist
 * for this long before we actually mark the app offline.
 *
 * Back-to-online is immediate — we never want the banner lingering once
 * the user reconnects.
 */
const OFFLINE_CONFIRM_MS = 1500;
let _pendingOfflineTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingOfflineTimer() {
  if (_pendingOfflineTimer != null) {
    clearTimeout(_pendingOfflineTimer);
    _pendingOfflineTimer = null;
  }
}

/**
 * Apply a raw network event to the store with flap-debouncing.
 * Kept internal so callers never bypass the debounce.
 */
function applyNetworkEvent(isConnected: boolean, isReachable: boolean | undefined) {
  // On iOS, `isInternetReachable` is always identical to `isConnected`.
  // On Android, it's a stricter check (reachability to the internet,
  // not just the access point). Use it when present.
  const looksOnline = isConnected && (isReachable ?? true);
  const store = useConnectivityStore.getState();

  if (looksOnline) {
    // Going back online — clear any pending "confirm offline" timer and
    // flip immediately. No debounce on the recovery edge.
    clearPendingOfflineTimer();
    if (store.phase !== "online") {
      store._setPhase("online");
    }
    return;
  }

  // Looks offline. Start (or keep) the confirm timer. If a follow-up
  // event flips us back online before the timer fires, the offline
  // UI never appears — perfect for elevators / short dropouts.
  if (store.phase === "offline") return;
  if (_pendingOfflineTimer) return;

  // Bridge UI state: we're "reconnecting" while we wait to see if this
  // sticks. Consumers that don't care about the nuance can just read
  // `isOnline`.
  if (store.phase === "online") {
    store._setPhase("reconnecting");
  }
  _pendingOfflineTimer = setTimeout(() => {
    _pendingOfflineTimer = null;
    const phase = useConnectivityStore.getState().phase;
    if (phase !== "online") {
      useConnectivityStore.getState()._setPhase("offline");
    }
  }, OFFLINE_CONFIRM_MS);
}

/**
 * Subscribe once at app boot. Safe to call multiple times — only the
 * first call attaches the listener. Call from the app root layout.
 */
export function initConnectivity() {
  if (_subscribed) return;
  _subscribed = true;

  // All expo-network access is wrapped in try/catch + null-guards
  // because this function is called from module-scope in _layout.tsx
  // and must never throw. A throw here crashes startup before React
  // can mount — exactly the failure mode we're hardening against.
  try {
    // Seed from a one-shot query so we reflect reality before the first
    // event arrives. Don't block — fire-and-forget.
    const getState = _expoNetwork?.getNetworkStateAsync;
    if (typeof getState === "function") {
      getState()
        .then((state) => {
          applyNetworkEvent(
            !!state?.isConnected,
            state?.isInternetReachable ?? undefined,
          );
        })
        .catch(() => {
          // expo-network failed — keep the optimistic "online" assumption
          // rather than falsely marking everyone offline.
        });
    }

    const addListener = _expoNetwork?.addNetworkStateListener;
    if (typeof addListener === "function") {
      const sub = addListener((event) => {
        applyNetworkEvent(
          !!event?.isConnected,
          event?.isInternetReachable ?? undefined,
        );
      });
      // sub may be undefined on older expo-network builds; .remove may
      // also be undefined. Both are tolerated — we just won't be able
      // to unsubscribe on hot reload (fine for prod which never does).
      const remove =
        sub && typeof (sub as { remove?: unknown }).remove === "function"
          ? (sub as { remove: () => void }).remove
          : null;
      _unsubscribe = remove;
    }
  } catch (e) {
    // Any throw here would crash module eval. Swallow and stay in
    // the optimistic-online seed state.
    console.warn("[Connectivity] init failed — staying optimistic-online:", e);
  }
}

/**
 * Teardown — only used by tests and dev reload. Production app calls
 * `initConnectivity()` once and never tears down.
 */
export function disposeConnectivity() {
  clearPendingOfflineTimer();
  _unsubscribe?.();
  _unsubscribe = null;
  _subscribed = false;
}

// ─── Synchronous getters for non-React callers ──────────────────────────────

/**
 * Sync check — is the app believed online right now?
 * Safe to call from mutation handlers, Zustand stores, etc. No React
 * subscription, no re-renders. Returns `true` during "reconnecting"
 * phase because requests fired during that window may still succeed.
 */
export function isOnline(): boolean {
  return useConnectivityStore.getState().phase !== "offline";
}

/**
 * Sync check — is the app definitely offline (flap-confirmed)?
 * Use this to GATE network-dependent user actions — it only returns
 * true after OFFLINE_CONFIRM_MS of confirmed disconnection.
 */
export function isOffline(): boolean {
  return useConnectivityStore.getState().phase === "offline";
}
