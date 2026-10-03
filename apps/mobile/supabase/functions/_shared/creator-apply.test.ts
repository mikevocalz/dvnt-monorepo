import { assert, assertEquals } from "jsr:@std/assert";
import { applyForCreatorProgram, UNIQUE_VIOLATION } from "./creator-apply.ts";

type Row = Record<string, unknown>;

/**
 * A creator_hosts table with a primary key on user_id and the real column
 * DEFAULT. insert() honours the key; upsert() and update() write through so a
 * regression that reintroduces either is caught by the row it changes.
 */
function fakeDb(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [String(r.user_id), { ...r }]));
  const writes: { op: string; payload: Row }[] = [];

  function from(table: string) {
    assertEquals(table, "creator_hosts");
    return {
      insert(payload: Row) {
        writes.push({ op: "insert", payload });
        const id = String(payload.user_id);
        const result = rows.has(id)
          ? { data: null, error: { code: UNIQUE_VIOLATION, message: "duplicate key" } }
          : (() => {
            const row = {
              status: "applied",
              payout_status: "not_started",
              terms_version: null,
              terms_accepted_at: null,
              ...payload,
            };
            rows.set(id, row);
            return { data: { ...row }, error: null };
          })();
        return { select: () => ({ single: async () => result }) };
      },
      upsert(payload: Row) {
        writes.push({ op: "upsert", payload });
        const id = String(payload.user_id);
        const row = { ...(rows.get(id) ?? {}), ...payload };
        rows.set(id, row);
        return { select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) };
      },
      update(payload: Row) {
        writes.push({ op: "update", payload });
        return {
          eq: async (_col: string, id: string) => {
            rows.set(id, { ...(rows.get(id) ?? {}), ...payload });
            return { error: null };
          },
        };
      },
      select() {
        return {
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({ data: rows.has(id) ? { ...rows.get(id) } : null, error: null }),
          }),
        };
      },
    };
  }

  return { db: { from }, rows, writes };
}

Deno.test("a new applicant gets the server default status, never a client one", async () => {
  const { db, rows, writes } = fakeDb();
  const outcome = await applyForCreatorProgram(db, "u1");

  assertEquals(outcome.kind, "created");
  assertEquals(outcome.httpStatus, 200);
  assertEquals(rows.get("u1")?.status, "applied");
  // The only write is an insert carrying the user id and nothing else.
  assertEquals(writes, [{ op: "insert", payload: { user_id: "u1" } }]);
});

Deno.test("a suspended creator cannot clear their suspension by applying", async () => {
  const suspended = {
    user_id: "u1",
    status: "suspended",
    payout_status: "restricted",
    terms_version: "creator-host-v1",
    terms_accepted_at: "2026-10-01T00:00:00.000Z",
    suspended_at: "2026-10-02T00:00:00.000Z",
    suspension_reason: "harassment",
  };
  const { db, rows, writes } = fakeDb([suspended]);
  const outcome = await applyForCreatorProgram(db, "u1");

  assertEquals(outcome.kind, "exists");
  assertEquals(outcome.httpStatus, 409);
  if (outcome.kind !== "exists") throw new Error("unreachable");
  assertEquals(outcome.code, "creator_application_exists");
  assertEquals(outcome.creator?.status, "suspended");
  assert(outcome.message.includes("suspended"));
  // The row is byte-for-byte what it was, audit fields included.
  assertEquals(rows.get("u1"), suspended);
  assert(writes.every((w) => w.op === "insert"), JSON.stringify(writes));
});

Deno.test("rejected, approved and in-flight rows are refused and left unchanged", async () => {
  for (const status of ["rejected", "approved", "applied", "under_review", "invited", "paused"]) {
    const seed = { user_id: "u1", status, payout_status: "not_started", terms_version: null, terms_accepted_at: null };
    const { db, rows, writes } = fakeDb([seed]);
    const outcome = await applyForCreatorProgram(db, "u1");

    assertEquals(outcome.httpStatus, 409, status);
    assertEquals(rows.get("u1"), seed, status);
    assert(writes.every((w) => w.op === "insert"), status);
  }
});

Deno.test("a failed insert is a 500, not a silent success", async () => {
  const db = {
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: { code: "08006", message: "down" } }) }),
      }),
    }),
  };
  const outcome = await applyForCreatorProgram(db, "u1");
  assertEquals(outcome.kind, "failed");
  assertEquals(outcome.httpStatus, 500);
});
