/**
 * OTA Update Safety Guard — DVNT
 *
 * Implements the pending-update confirmation lifecycle and bad-update
 * kill-switch that prevent crash loops after a bad OTA.
 *
 * CRASH LOOP SCENARIO (what this prevents):
 *   1. Bad OTA applied → app crashes on launch
 *   2. expo-updates ON_ERROR_RECOVERY fires → fetches same bad OTA
 *   3. Crash loop → user must delete + reinstall
 *
 * HOW THIS FIXES IT:
 *   - Before reloadAsync(): write pendingUpdateId to MMKV
 *   - On NEXT launch: if pendingUpdateId still present → app crashed
 *     during that update → mark update ID as "bad"
 *   - Bad update IDs are never applied again (kill-switch)
 *   - After 3 consecutive bad attempts for the SAME update → block it
 *     and show recovery UI instead
 *
 * MMKV Keys (dedicated instance: "dvnt-ota-safety"):
 *   pending_update_id       — update ID written before reloadAsync
 *   pending_update_ts       — timestamp of the pending write
 *   pending_apply_count     — how many times we've tried this ID
 *   bad_update_ids          — JSON array of known-bad update IDs
 *   last_confirmed_update   — last update ID that booted successfully
 *   last_confirmed_at       — timestamp of last confirmed good launch
 *   crash_recovery_entered  — flag: recovery UI shown this session
 */

import { mmkv as storage } from "@/lib/mmkv-zustand";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_APPLY_ATTEMPTS = 3;    // Blacklist after 3 failed applies of same ID
const PENDING_TIMEOUT_MS = 30_000; // If pending > 30s old without confirmation → assume crash

// MMKV Keys — prefixed to avoid collisions with Zustand store keys
const K_PENDING_ID    = "__ota__pending_update_id";
const K_PENDING_TS    = "__ota__pending_update_ts";
const K_PENDING_COUNT = "__ota__pending_apply_count";
const K_BAD_IDS       = "__ota__bad_update_ids";
const K_CONFIRMED_ID  = "__ota__last_confirmed_update";
const K_CONFIRMED_AT  = "__ota__last_confirmed_at";

function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// ── Bad update ID set ─────────────────────────────────────────────────────────

function getBadIds(): Set<string> {
  if (!storage) return new Set();
  const raw = safeGet(() => storage!.getString(K_BAD_IDS), null);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveBadIds(ids: Set<string>): void {
  if (!storage) return;
  safeGet(() => storage!.set(K_BAD_IDS, JSON.stringify(Array.from(ids))), undefined);
}

function addBadId(updateId: string): void {
  const ids = getBadIds();
  ids.add(updateId);
  // Cap list at 50 entries to avoid bloat
  if (ids.size > 50) {
    const arr = Array.from(ids);
    const trimmed = arr.slice(arr.length - 50);
    saveBadIds(new Set(trimmed));
  } else {
    saveBadIds(ids);
  }
  console.error(`[UpdateSafety] Blacklisted bad update ID: ${updateId}`);
}

// ── Module-level state (resolved at import time) ──────────────────────────────

let _crashedOnPendingUpdate = false;
let _pendingUpdateIdAtBoot: string | null = null;

/**
 * Called at module import time (before React renders).
 * Checks if the previous launch was a pending-update crash.
 */
function checkPendingCrash(): void {
  if (!storage) return;

  try {
    const pendingId = safeGet(() => storage!.getString(K_PENDING_ID), null);
    const pendingTs = safeGet(() => storage!.getNumber(K_PENDING_TS), null);
    const pendingCount = safeGet(() => storage!.getNumber(K_PENDING_COUNT), 0) ?? 0;

    if (!pendingId || !pendingTs) return;

    // If the pending marker is still set, the last launch crashed before
    // confirmUpdateSuccess() was called.
    const age = Date.now() - pendingTs;
    if (age > PENDING_TIMEOUT_MS) {
      // The update was applied but the app crashed before confirming
      _crashedOnPendingUpdate = true;
      _pendingUpdateIdAtBoot = pendingId;

      const newCount = pendingCount + 1;
      console.error(
        `[UpdateSafety] Detected crash after OTA update: ${pendingId} ` +
        `(attempt ${newCount}/${MAX_APPLY_ATTEMPTS})`
      );

      if (newCount >= MAX_APPLY_ATTEMPTS) {
        addBadId(pendingId);
        console.error(`[UpdateSafety] Update ${pendingId} exceeded max attempts — blacklisted`);
      } else {
        // Increment attempt counter without clearing the pending ID
        storage!.set(K_PENDING_COUNT, newCount);
      }

      // Clear the pending marker so this session can run cleanly
      storage!.remove(K_PENDING_ID);
      storage!.remove(K_PENDING_TS);
      storage!.remove(K_PENDING_COUNT);
    }
  } catch (e) {
    console.error("[UpdateSafety] checkPendingCrash error:", e);
  }
}

// Run immediately at module load (synchronous)
checkPendingCrash();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Whether the last OTA-reloaded launch crashed before confirming success.
 * Read synchronously — safe to check before React renders.
 */
export function didCrashOnPendingUpdate(): boolean {
  return _crashedOnPendingUpdate;
}

/**
 * The update ID that was "pending" when the crash was detected.
 */
export function getPendingUpdateIdAtBoot(): string | null {
  return _pendingUpdateIdAtBoot;
}

/**
 * Returns true if this update ID is known-bad and should not be applied.
 */
export function isKnownBadUpdate(updateId: string | null | undefined): boolean {
  if (!updateId) return false;
  return getBadIds().has(updateId);
}

/**
 * Call this IMMEDIATELY BEFORE reloadAsync().
 * Writes a pending marker so the next launch can detect a crash.
 *
 * @param updateId - The update ID about to be applied
 */
export function markUpdatePending(updateId: string | null): void {
  if (!storage || !updateId) return;
  try {
    const currentCount = safeGet(() => storage!.getNumber(K_PENDING_COUNT), 0) ?? 0;
    storage.set(K_PENDING_ID, updateId);
    storage.set(K_PENDING_TS, Date.now());
    storage.set(K_PENDING_COUNT, currentCount);
    console.log(`[UpdateSafety] Marked update pending: ${updateId} (attempt ${currentCount + 1})`);
  } catch (e) {
    console.error("[UpdateSafety] markUpdatePending error:", e);
  }
}

/**
 * Call this when the app has fully booted after an OTA reload.
 * Clears the pending marker and records this update as confirmed-good.
 *
 * Integrate with markBootCompleted() in boot-guard.ts.
 *
 * @param updateId - The currently running update ID (from Updates.updateId)
 */
export function confirmUpdateSuccess(updateId: string | null): void {
  if (!storage) return;
  try {
    storage.remove(K_PENDING_ID);
    storage.remove(K_PENDING_TS);
    storage.remove(K_PENDING_COUNT);

    if (updateId) {
      storage.set(K_CONFIRMED_ID, updateId);
      storage.set(K_CONFIRMED_AT, Date.now());
      console.log(`[UpdateSafety] Update confirmed good: ${updateId}`);
    }
  } catch (e) {
    console.error("[UpdateSafety] confirmUpdateSuccess error:", e);
  }
}

/**
 * Manually add an update ID to the blacklist (e.g., from a remote kill-switch).
 */
export function blockUpdateId(updateId: string): void {
  addBadId(updateId);
}

/**
 * Get the full safety diagnostics snapshot.
 */
export function getUpdateSafetyDiagnostics(): {
  crashedOnPendingUpdate: boolean;
  pendingUpdateIdAtBoot: string | null;
  badUpdateIds: string[];
  lastConfirmedUpdateId: string | null;
  lastConfirmedAt: number | null;
} {
  const badIds = getBadIds();
  return {
    crashedOnPendingUpdate: _crashedOnPendingUpdate,
    pendingUpdateIdAtBoot: _pendingUpdateIdAtBoot,
    badUpdateIds: Array.from(badIds),
    lastConfirmedUpdateId: safeGet(() => storage?.getString(K_CONFIRMED_ID) ?? null, null),
    lastConfirmedAt: safeGet(() => storage?.getNumber(K_CONFIRMED_AT) ?? null, null),
  };
}
