/**
 * Outbox store factory — MMKV-persisted Zustand queue (WS-12).
 *
 * Pure zustand: no react-native / MMKV imports here so the store logic is
 * testable under `node --import tsx --test` (see outbox.test.ts, which
 * simulates an app restart by re-creating the store over the same backing
 * storage). Production wiring (MMKV id "dvnt-outbox", drain triggers)
 * lives in `./index.ts`.
 */

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist, type StateStorage, createJSONStorage } from "zustand/middleware";
import type { EnqueueInput, OutboxEntry } from "./types";

export interface OutboxState {
  /** FIFO queue — enqueue order IS drain order (per-entity ordering holds). */
  entries: OutboxEntry[];

  /**
   * Mint the idempotency key HERE, once, at enqueue time. It persists with
   * the entry, so a retry after an app restart replays the SAME key and
   * the server dedupe table (`client_mutations`) can drop the duplicate.
   */
  enqueue: (input: EnqueueInput) => OutboxEntry;
  markInflight: (idempotencyKey: string) => void;
  /** Failed retryably — back to 'queued' with backoff bookkeeping. */
  markRetry: (
    idempotencyKey: string,
    lastError: string,
    nextAttemptAt: number,
  ) => void;
  /** Failed permanently — retained, never retried, never silently dropped. */
  markTerminal: (idempotencyKey: string, lastError: string) => void;
  /** Success — the only path that deletes an entry (besides explicit discard). */
  remove: (idempotencyKey: string) => void;
  /** Operator/UI escape hatch for parked 'failed_terminal' entries. */
  discardTerminal: (idempotencyKey: string) => void;
}

function patchEntry(
  entries: OutboxEntry[],
  key: string,
  patch: Partial<OutboxEntry>,
): OutboxEntry[] {
  return entries.map((e) =>
    e.idempotencyKey === key ? { ...e, ...patch } : e,
  );
}

export type OutboxStore = UseBoundStore<StoreApi<OutboxState>>;

export function createOutboxStore(storage: StateStorage): OutboxStore {
  return create<OutboxState>()(
    persist(
      (set, get) => ({
        entries: [],

        enqueue: (input) => {
          const entry: OutboxEntry = {
            idempotencyKey: crypto.randomUUID(),
            mutationType: input.mutationType,
            entityType: input.entityType,
            entityRef: input.entityRef,
            payload: input.payload,
            createdAt: Date.now(),
            attempts: 0,
            lastError: null,
            status: "queued",
          };
          set({ entries: [...get().entries, entry] });
          return entry;
        },

        markInflight: (key) =>
          set((s) => ({
            entries: patchEntry(s.entries, key, { status: "inflight" }),
          })),

        markRetry: (key, lastError, nextAttemptAt) =>
          set((s) => ({
            entries: s.entries.map((e) =>
              e.idempotencyKey === key
                ? {
                    ...e,
                    status: "queued" as const,
                    attempts: e.attempts + 1,
                    lastError,
                    nextAttemptAt,
                  }
                : e,
            ),
          })),

        markTerminal: (key, lastError) =>
          set((s) => ({
            entries: s.entries.map((e) =>
              e.idempotencyKey === key
                ? {
                    ...e,
                    status: "failed_terminal" as const,
                    attempts: e.attempts + 1,
                    lastError,
                  }
                : e,
            ),
          })),

        remove: (key) =>
          set((s) => ({
            entries: s.entries.filter((e) => e.idempotencyKey !== key),
          })),

        discardTerminal: (key) =>
          set((s) => ({
            entries: s.entries.filter(
              (e) =>
                !(
                  e.idempotencyKey === key && e.status === "failed_terminal"
                ),
            ),
          })),
      }),
      {
        name: "dvnt-outbox",
        storage: createJSONStorage(() => storage),
        // Persist the queue only — actions are re-created on load.
        partialize: (s) => ({ entries: s.entries }),
        // Crash-recovery: anything persisted as 'inflight' died mid-flight
        // (app killed between markInflight and the executor settling).
        // Requeue it — the idempotency key makes the replay safe even if
        // the original request actually landed server-side.
        merge: (persisted, current) => {
          const p = persisted as { entries?: OutboxEntry[] } | undefined;
          const entries = (p?.entries ?? []).map((e) =>
            e.status === "inflight" ? { ...e, status: "queued" as const } : e,
          );
          return { ...current, entries };
        },
      },
    ),
  );
}
