/**
 * Outbox tests. Run with the repo's tsx (no new framework), same as
 * lib/tickets/pricing.test.ts:
 *   node --import tsx --test packages/app/lib/outbox/outbox.test.ts
 *
 * Covers: enqueue→drain success, retry backoff on retryable failure,
 * terminal-failure parking (4xx / OutboxTerminalError), and idempotency
 * key stability across a simulated app restart (store re-hydration over
 * the same backing storage).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { StateStorage } from "zustand/middleware";
import { createOutboxStore } from "./store";
import {
  drainOutbox,
  registerOutboxExecutor,
  unregisterOutboxExecutor,
  backoffMs,
  MONEY_DENYLIST,
} from "./drain";
import { OutboxTerminalError, type OutboxEntry } from "./types";

/** In-memory StateStorage that survives store re-creation (simulated restart). */
function memoryStorage(): StateStorage & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => void map.set(name, value),
    removeItem: (name) => void map.delete(name),
    dump: () => map,
  };
}

const INPUT = {
  mutationType: "test.echo",
  entityType: "event",
  entityRef: "ev-1",
  payload: { event_id: 42, on: true },
};

test("enqueue → drain success removes the entry and passes idempotency key to the executor", async () => {
  const store = createOutboxStore(memoryStorage());
  const seen: OutboxEntry[] = [];
  registerOutboxExecutor("test.echo", async (entry) => {
    seen.push(entry);
  });
  try {
    const entry = store.getState().enqueue(INPUT);
    assert.match(
      entry.idempotencyKey,
      /^[0-9a-f-]{36}$/,
      "key is a client-minted UUID",
    );
    assert.equal(entry.status, "queued");
    assert.equal(entry.attempts, 0);

    const result = await drainOutbox(store);
    assert.equal(result.succeeded, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.idempotencyKey, entry.idempotencyKey);
    assert.deepEqual(seen[0]!.payload, INPUT.payload);
    assert.equal(store.getState().entries.length, 0, "success deletes entry");
  } finally {
    unregisterOutboxExecutor("test.echo");
  }
});

test("retryable failure backs off exponentially and retains the entry", async () => {
  const store = createOutboxStore(memoryStorage());
  let calls = 0;
  registerOutboxExecutor("test.echo", async () => {
    calls += 1;
    throw new Error("network flake");
  });
  try {
    store.getState().enqueue(INPUT);

    let clock = 1_000_000;
    const now = () => clock;
    const random = () => 0; // deterministic: no jitter

    // Pass 1 — attempt 1 fails, nextAttemptAt = now + base (2s).
    const r1 = await drainOutbox(store, { now, random });
    assert.equal(r1.retried, 1);
    assert.equal(calls, 1);
    let e = store.getState().entries[0]!;
    assert.equal(e.status, "queued");
    assert.equal(e.attempts, 1);
    assert.equal(e.lastError, "network flake");
    assert.equal(e.nextAttemptAt, clock + 2_000);
    assert.equal(r1.nextDueInMs, 2_000);

    // Pass before backoff elapses — entry not due, executor NOT called.
    const rEarly = await drainOutbox(store, { now, random });
    assert.equal(calls, 1, "not retried before backoff elapses");
    assert.equal(rEarly.retried, 0);

    // Advance past backoff — attempt 2 fails, backoff doubles (4s).
    clock += 2_001;
    const r2 = await drainOutbox(store, { now, random });
    assert.equal(r2.retried, 1);
    assert.equal(calls, 2);
    e = store.getState().entries[0]!;
    assert.equal(e.attempts, 2);
    assert.equal(e.nextAttemptAt! - clock, 4_000, "exponential: 2s → 4s");

    // Jitter is bounded [0, 1000).
    const withJitter = backoffMs(0, () => 0.5);
    assert.equal(withJitter, 2_000 + 500);

    assert.equal(store.getState().entries.length, 1, "retained on failure");
  } finally {
    unregisterOutboxExecutor("test.echo");
  }
});

test("terminal failure (OutboxTerminalError / 4xx) parks the entry, never drops or retries it", async () => {
  const store = createOutboxStore(memoryStorage());
  let calls = 0;
  registerOutboxExecutor("test.echo", async () => {
    calls += 1;
    throw new OutboxTerminalError("validation failed");
  });
  try {
    store.getState().enqueue(INPUT);
    const r1 = await drainOutbox(store);
    assert.equal(r1.terminal, 1);
    const e = store.getState().entries[0]!;
    assert.equal(e.status, "failed_terminal");
    assert.equal(e.lastError, "validation failed");
    assert.equal(e.attempts, 1);

    // Subsequent drains must not touch it.
    await drainOutbox(store);
    assert.equal(calls, 1, "terminal entries are never retried");
    assert.equal(
      store.getState().entries.length,
      1,
      "terminal entries are retained, not dropped",
    );

    // Plain error carrying a 4xx status is terminal too (429/408 are not).
    store.getState().discardTerminal(e.idempotencyKey);
    unregisterOutboxExecutor("test.echo");
    registerOutboxExecutor("test.echo", async () => {
      const err = new Error("bad request") as Error & { status: number };
      err.status = 422;
      throw err;
    });
    store.getState().enqueue(INPUT);
    const r2 = await drainOutbox(store);
    assert.equal(r2.terminal, 1);
    assert.equal(store.getState().entries[0]!.status, "failed_terminal");
  } finally {
    unregisterOutboxExecutor("test.echo");
  }
});

test("idempotency key is stable across a simulated app restart (re-hydration), and inflight resets to queued", async () => {
  const storage = memoryStorage();

  // Session 1: enqueue two entries; leave one stuck 'inflight' (app died
  // between markInflight and the executor settling).
  const session1 = createOutboxStore(storage);
  const a = session1.getState().enqueue(INPUT);
  const b = session1.getState().enqueue({ ...INPUT, entityRef: "ev-2" });
  session1.getState().markInflight(b.idempotencyKey);

  // Session 2: fresh store over the SAME storage (synchronous MMKV-style
  // hydration). Keys must be identical — that's what makes the server-side
  // client_mutations dedupe (body field `idempotency_key`) safe on replay.
  const session2 = createOutboxStore(storage);
  const entries = session2.getState().entries;
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.idempotencyKey).sort(),
    [a.idempotencyKey, b.idempotencyKey].sort(),
    "keys survive restart unchanged",
  );
  assert.ok(
    entries.every((e) => e.status === "queued"),
    "persisted 'inflight' resets to 'queued' on hydration",
  );

  // And the replay carries the original key into the executor.
  const replayed: string[] = [];
  registerOutboxExecutor("test.echo", async (entry) => {
    replayed.push(entry.idempotencyKey);
  });
  try {
    await drainOutbox(session2);
    assert.deepEqual(
      replayed.sort(),
      [a.idempotencyKey, b.idempotencyKey].sort(),
    );
  } finally {
    unregisterOutboxExecutor("test.echo");
  }
});

test("money law: checkout/refund/payout mutationTypes are refused at registration (dev throw)", () => {
  for (const type of [
    "ticket.checkout",
    "order.refund",
    "host.payout",
    "REFUND-bulk",
  ]) {
    assert.match(type.toLowerCase(), MONEY_DENYLIST);
    assert.throws(
      () => registerOutboxExecutor(type, async () => {}),
      /money mutations/,
      `${type} must be denied`,
    );
  }
});
