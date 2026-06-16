/**
 * Crash-Safe Boot Guard
 *
 * Prevents crash loops by tracking consecutive failed boots.
 * If the app crashes N times during early startup, the next launch
 * enters SAFE MODE: risky caches are cleared, heavy prefetch is skipped,
 * and a recovery banner is shown.
 *
 * Architecture:
 * - Dedicated MMKV instance (dvnt-boot-guard) — never cleared by user logout
 * - Module-level init: runs BEFORE React renders (synchronous MMKV reads)
 * - Boot checkpoint: called when first screen renders successfully
 * - Safe mode: clears TanStack Query cache + user data stores, skips prefetch
 *
 * MMKV Keys:
 *   consecutive_failed_boots  — incremented on launch, reset on checkpoint
 *   last_launch_started_at    — timestamp of most recent launch
 *   last_boot_completed_at    — timestamp of most recent successful boot
 *   safe_mode_entered_count   — lifetime count of safe mode activations
 */

import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

// ── Constants ────────────────────────────────────────────────────────

const SAFE_MODE_THRESHOLD = 3; // Enter safe mode after this many consecutive crashes
const BOOT_TIMEOUT_MS = 15_000; // If boot hasn't completed in 15s, count as failed

// MMKV Keys
const K_CONSECUTIVE_FAILED = "consecutive_failed_boots";
const K_LAUNCH_STARTED = "last_launch_started_at";
const K_BOOT_COMPLETED = "last_boot_completed_at";
const K_SAFE_MODE_COUNT = "safe_mode_entered_count";

// ── MMKV Instance (dedicated, separate from app stores) ──────────────

let guardStorage: ReturnType<typeof createMMKV> | null = null;

try {
  if (Platform.OS !== "web") {
    guardStorage = createMMKV({ id: "dvnt-boot-guard" });
  }
} catch (error) {
  console.error("[BootGuard] Failed to initialize MMKV:", error);
}

// ── Module-level state ───────────────────────────────────────────────

let _safeMode = false;
let _bootCompleted = false;
let _consecutiveFailedBoots = 0;

// ── Init (runs synchronously on module import) ───────────────────────

function init(): void {
  if (!guardStorage) return;

  try {
    // Read previous state
    const prevFailed = guardStorage.getNumber(K_CONSECUTIVE_FAILED) ?? 0;
    const lastLaunch = guardStorage.getNumber(K_LAUNCH_STARTED) ?? 0;
    const lastCompleted = guardStorage.getNumber(K_BOOT_COMPLETED) ?? 0;

    // Check if the previous launch timed out (started but never completed)
    const previousBootTimedOut =
      lastLaunch > 0 &&
      lastCompleted < lastLaunch &&
      Date.now() - lastLaunch > BOOT_TIMEOUT_MS;

    // Increment failed boot counter
    _consecutiveFailedBoots = previousBootTimedOut
      ? prevFailed + 1
      : prevFailed;

    // Record this launch
    guardStorage.set(K_LAUNCH_STARTED, Date.now());
    guardStorage.set(K_CONSECUTIVE_FAILED, _consecutiveFailedBoots);

    // Determine safe mode
    if (_consecutiveFailedBoots >= SAFE_MODE_THRESHOLD) {
      _safeMode = true;
      const lifetime = (guardStorage.getNumber(K_SAFE_MODE_COUNT) ?? 0) + 1;
      guardStorage.set(K_SAFE_MODE_COUNT, lifetime);

      console.error(
        `[BootGuard] SAFE MODE ACTIVATED — ${_consecutiveFailedBoots} consecutive failed boots ` +
          `(lifetime activations: ${lifetime})`,
      );
    } else if (_consecutiveFailedBoots > 0) {
      console.warn(
        `[BootGuard] ${_consecutiveFailedBoots}/${SAFE_MODE_THRESHOLD} failed boots`,
      );
    }
  } catch (error) {
    console.error("[BootGuard] Init error:", error);
  }
}

// Run init immediately on module load
init();

// ── Public API ───────────────────────────────────────────────────────

/**
 * Whether the app is in safe mode (too many consecutive failed boots).
 * Read this synchronously from any module — value is set before React renders.
 */
export function isSafeMode(): boolean {
  return _safeMode;
}

/**
 * Number of consecutive failed boots detected on this launch.
 */
export function getConsecutiveFailedBoots(): number {
  return _consecutiveFailedBoots;
}

/**
 * Call this when the app has successfully booted:
 * - Splash animation finished
 * - Auth state settled
 * - First screen rendered
 *
 * Resets the failed boot counter to 0.
 */
export function markBootCompleted(): void {
  if (_bootCompleted) return; // Idempotent
  _bootCompleted = true;

  if (!guardStorage) return;

  try {
    guardStorage.set(K_BOOT_COMPLETED, Date.now());
    guardStorage.set(K_CONSECUTIVE_FAILED, 0);
    _consecutiveFailedBoots = 0;

    if (_safeMode) {
      console.log(
        "[BootGuard] Boot completed in SAFE MODE — counter reset. " +
          "Safe mode remains active for this session.",
      );
    } else {
      console.log("[BootGuard] Boot completed — counter reset to 0");
    }
  } catch (error) {
    console.error("[BootGuard] markBootCompleted error:", error);
  }
}

/**
 * Clear risky caches that could cause a crash loop.
 * Called automatically when entering safe mode.
 *
 * Clears:
 * - TanStack Query persisted cache (dvnt-query-cache MMKV)
 * - User data stores (post-storage, bookmark-storage, chat-storage, etc.)
 * - Call trace buffer
 *
 * Preserves:
 * - Auth session (auth-storage) — user stays logged in
 * - App settings (nsfw, etc.)
 * - Boot guard counters (this module)
 */
export function clearRiskyCaches(): void {
  console.warn("[BootGuard] Clearing risky caches for safe mode boot");

  try {
    // 1. TanStack Query persisted cache
    const queryCache = createMMKV({ id: "dvnt-query-cache" });
    queryCache.clearAll();
    console.log("[BootGuard] Cleared: dvnt-query-cache");
  } catch (e) {
    console.error("[BootGuard] Failed to clear query cache:", e);
  }

  try {
    // 2. User data in dvnt-storage (post-storage, bookmark-storage, chat-storage, etc.)
    const appStorage = createMMKV({ id: "dvnt-storage" });
    const riskyKeys = [
      "post-storage",
      "bookmark-storage",
      "chat-storage",
      "lynk-history-storage",
    ];
    riskyKeys.forEach((key) => {
      try {
        appStorage.remove(key);
      } catch {}
    });
    console.log("[BootGuard] Cleared: risky dvnt-storage keys");
  } catch (e) {
    console.error("[BootGuard] Failed to clear app storage:", e);
  }

  try {
    // 3. Zustand persisted stores that might have corrupt JSON
    const zustandStorage = createMMKV({ id: "zustand-persist" });
    // Only clear data stores, NOT auth or app settings
    const riskyZustandKeys = [
      "chat-storage",
      "ticket-storage",
      "event-store",
    ];
    riskyZustandKeys.forEach((key) => {
      try {
        zustandStorage.remove(key);
      } catch {}
    });
    console.log("[BootGuard] Cleared: risky zustand-persist keys");
  } catch (e) {
    console.error("[BootGuard] Failed to clear zustand storage:", e);
  }

  try {
    // 4. Call trace (can contain large JSON blobs)
    const callTrace = createMMKV({ id: "call-trace" });
    callTrace.clearAll();
    console.log("[BootGuard] Cleared: call-trace");
  } catch (e) {
    console.error("[BootGuard] Failed to clear call trace:", e);
  }
}

/**
 * Diagnostics object for logging/reporting.
 */
export function getBootDiagnostics(): {
  safeMode: boolean;
  consecutiveFailedBoots: number;
  bootCompleted: boolean;
  lifetimeSafeModeCount: number;
  lastLaunchStartedAt: number;
  lastBootCompletedAt: number;
} {
  return {
    safeMode: _safeMode,
    consecutiveFailedBoots: _consecutiveFailedBoots,
    bootCompleted: _bootCompleted,
    lifetimeSafeModeCount: guardStorage?.getNumber(K_SAFE_MODE_COUNT) ?? 0,
    lastLaunchStartedAt: guardStorage?.getNumber(K_LAUNCH_STARTED) ?? 0,
    lastBootCompletedAt: guardStorage?.getNumber(K_BOOT_COMPLETED) ?? 0,
  };
}

// If safe mode, clear caches immediately (before React renders)
if (_safeMode) {
  clearRiskyCaches();
}
