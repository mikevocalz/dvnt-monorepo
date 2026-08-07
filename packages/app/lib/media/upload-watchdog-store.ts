/**
 * Upload Watchdog Registry — MMKV-persisted Zustand store (WS-10 × WS-11)
 *
 * Durable trace of in-flight media uploads. Every upload that passes through
 * `uploadToServer` (lib/server-upload.ts) records an "uploading" entry here on
 * start and removes it on success; a failed upload is retained as "failed".
 *
 * WHY THIS EXISTS — and its honest limits:
 * RN multipart upload (`FileSystem.uploadAsync`) is NOT a native background
 * URLSession: it runs on the JS thread and DIES with the JS context if the app
 * is killed mid-upload. There is nothing to "resume" from the OS side — the
 * bytes were never handed to a background transfer daemon. So a crash/kill
 * during an upload leaves an "uploading" entry here that never settled.
 *
 * The WS-11 upload-watchdog background job (lib/background-tasks) SWEEPS this
 * registry: entries stuck in "uploading" past STUCK_THRESHOLD_MS are flipped to
 * "stuck" (durable, surfaced via `getStuckUploads()` so a foreground screen can
 * offer "Resume upload"). The job does NOT silently re-run compression + upload
 * in the ~30s background window — heavy media work belongs in the foreground on
 * an explicit user action. Detect + surface here; re-drive there.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

/** An upload that has not settled successfully is "uploading", "failed", or "stuck". */
export type UploadWatchStatus = "uploading" | "failed" | "stuck";

export interface UploadWatchEntry {
  id: string;
  sourceUri: string;
  folder: string;
  status: UploadWatchStatus;
  startedAt: number; // ms-epoch
  updatedAt: number; // ms-epoch
}

/**
 * An "uploading" entry older than this with no settlement is treated as stuck
 * (the JS context that owned it is gone). 5 minutes comfortably exceeds a
 * legitimate compress+upload of a 50 MB clip while still catching real hangs.
 */
export const STUCK_THRESHOLD_MS = 5 * 60_000;

interface UploadWatchdogState {
  entries: UploadWatchEntry[];
  begin: (sourceUri: string, folder: string) => string;
  settle: (id: string, success: boolean) => void;
  /** Flip long-running "uploading" entries to "stuck". Returns the stuck count. */
  sweep: (now?: number) => number;
  getStuck: () => UploadWatchEntry[];
  clear: (id: string) => void;
}

function makeId(): string {
  return `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useUploadWatchdogStore = create<UploadWatchdogState>()(
  persist(
    (set, get) => ({
      entries: [],

      begin: (sourceUri, folder) => {
        const id = makeId();
        const now = Date.now();
        set((state) => ({
          entries: [
            ...state.entries,
            { id, sourceUri, folder, status: "uploading", startedAt: now, updatedAt: now },
          ],
        }));
        return id;
      },

      settle: (id, success) =>
        set((state) => {
          if (success) {
            // Landed on the server — nothing left to watch.
            return { entries: state.entries.filter((e) => e.id !== id) };
          }
          const now = Date.now();
          return {
            entries: state.entries.map((e) =>
              e.id === id ? { ...e, status: "failed", updatedAt: now } : e,
            ),
          };
        }),

      sweep: (now = Date.now()) => {
        let stuck = 0;
        set((state) => ({
          entries: state.entries.map((e) => {
            if (e.status === "uploading" && now - e.startedAt > STUCK_THRESHOLD_MS) {
              stuck += 1;
              return { ...e, status: "stuck", updatedAt: now };
            }
            if (e.status === "stuck") stuck += 1;
            return e;
          }),
        }));
        return stuck;
      },

      getStuck: () => get().entries.filter((e) => e.status === "stuck"),

      clear: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
    }),
    {
      name: "upload-watchdog-store",
      storage: mmkvStorage,
    },
  ),
);

// ─── Non-React helpers (used by server-upload chokepoint + background job) ────
// All swallow errors — recording an upload must never break the upload itself.

/** Record an upload starting. Returns an id to pass to `settleUpload`. */
export function beginUpload(sourceUri: string, folder: string): string {
  try {
    return useUploadWatchdogStore.getState().begin(sourceUri, folder);
  } catch {
    return "";
  }
}

/** Record an upload finishing. Success removes the entry; failure retains it. */
export function settleUpload(id: string, success: boolean): void {
  if (!id) return;
  try {
    useUploadWatchdogStore.getState().settle(id, success);
  } catch {
    // best-effort registry — never surface to the upload caller
  }
}

/**
 * Sweep stuck uploads. Returns the number of stuck (unsettled/failed→stuck)
 * uploads now surfaced. Called by the WS-11 background upload-watchdog job.
 */
export function sweepStuckUploads(): number {
  try {
    return useUploadWatchdogStore.getState().sweep();
  } catch {
    return 0;
  }
}

/** Entries currently surfaced as stuck (for a foreground "Resume upload" prompt). */
export function getStuckUploads(): UploadWatchEntry[] {
  try {
    return useUploadWatchdogStore.getState().getStuck();
  } catch {
    return [];
  }
}
