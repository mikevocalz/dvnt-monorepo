import { assert, assertEquals } from "jsr:@std/assert";
import { applyForCreatorProgram, UNIQUE_VIOLATION } from "./creator-apply.ts";

type Row = Record<string, unknown>;
type Write = { op: string; payload: Row; filters?: [string, unknown][] };

/**
 * A creator_hosts table with a primary key on user_id and the real column
 * DEFAULT. insert() honours the key; upsert() and update() write through so a
 * regression that reintroduces either is caught by the row it changes.
 */
function fakeDb(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((r) => [String(r.user_id), { ...r }]));
  const writes: Write[] = [];

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
        // Filters are honoured, so a conditional update only touches the
        // rows it names. An update without the status filter writes through.
        const filters: [string, unknown][] = [];
        writes.push({ op: "update", payload, filters });
        const apply = () => {
          const hit = [...rows.values()].filter((r) => filters.every(([c, v]) => r[c] === v));
          for (const r of hit) rows.set(String(r.user_id), { ...r, ...payload });
          return hit.map((r) => ({ ...rows.get(String(r.user_id)) }));
        };
        const builder = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          select: () => ({
            maybeSingle: async () => {
              const hit = apply();
              return { data: hit[0] ?? null, error: null };
            },
          }),
          then(resolve: (v: unknown) => void) {
            apply();
            resolve({ error: null });
          },
        };
        return builder;
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
  assert(onlyInviteAcceptUpdates(writes, "u1"), JSON.stringify(writes));
});

/**
 * The only update this path may issue: status to 'applied', keyed on the
 * caller AND on the row still being 'invited'.
 */
function onlyInviteAcceptUpdates(writes: Write[], authId: string) {
  return writes.every((w) =>
    w.op === "insert" ||
    (w.op === "update" &&
      JSON.stringify(w.payload) === JSON.stringify({ status: "applied" }) &&
      JSON.stringify(w.filters) === JSON.stringify([["user_id", authId], ["status", "invited"]]))
  );
}

Deno.test("every non-invited status is refused and left byte-identical", async () => {
  for (const status of ["applied", "under_review", "approved", "paused", "rejected", "suspended"]) {
    const seed = {
      user_id: "u1",
      status,
      payout_status: "not_started",
      terms_version: "creator-host-v1",
      terms_accepted_at: "2026-10-01T00:00:00.000Z",
      suspended_at: status === "suspended" ? "2026-10-02T00:00:00.000Z" : null,
    };
    const { db, rows, writes } = fakeDb([seed]);
    const outcome = await applyForCreatorProgram(db, "u1");

    assertEquals(outcome.httpStatus, 409, status);
    if (outcome.kind !== "exists") throw new Error(status);
    assertEquals(outcome.code, "creator_application_exists", status);
    assertEquals(outcome.creator?.status, status, status);
    assertEquals(rows.get("u1"), seed, status);
    assert(onlyInviteAcceptUpdates(writes, "u1"), `${status} ${JSON.stringify(writes)}`);
  }
});

Deno.test("an invited user who applies moves to applied, and nothing else changes", async () => {
  const seed = {
    user_id: "u1",
    status: "invited",
    payout_status: "not_started",
    terms_version: null,
    terms_accepted_at: null,
  };
  const other = { ...seed, user_id: "u2" };
  const { db, rows, writes } = fakeDb([seed, other]);
  const outcome = await applyForCreatorProgram(db, "u1");

  assertEquals(outcome.kind, "accepted");
  assertEquals(outcome.httpStatus, 200);
  if (outcome.kind !== "accepted") throw new Error("unreachable");
  assertEquals(outcome.creator.status, "applied");
  assertEquals(rows.get("u1"), { ...seed, status: "applied" });
  // Another invited user's row is untouched.
  assertEquals(rows.get("u2"), other);
  assert(onlyInviteAcceptUpdates(writes, "u1"), JSON.stringify(writes));
});

Deno.test("a second apply after the invite is accepted gets the 409", async () => {
  const seed = { user_id: "u1", status: "invited", payout_status: "not_started", terms_version: null, terms_accepted_at: null };

  // Back to back.
  {
    const { db, rows } = fakeDb([seed]);
    const first = await applyForCreatorProgram(db, "u1");
    const second = await applyForCreatorProgram(db, "u1");
    assertEquals(first.kind, "accepted");
    assertEquals(second.httpStatus, 409);
    if (second.kind !== "exists") throw new Error("unreachable");
    assertEquals(second.creator?.status, "applied");
    assertEquals(rows.get("u1")?.status, "applied");
  }

  // Two requests in flight at once: exactly one wins the conditional update.
  {
    const { db, rows } = fakeDb([seed]);
    const outcomes = await Promise.all([
      applyForCreatorProgram(db, "u1"),
      applyForCreatorProgram(db, "u1"),
    ]);
    assertEquals(outcomes.map((o) => o.httpStatus).sort(), [200, 409]);
    assertEquals(outcomes.filter((o) => o.kind === "accepted").length, 1);
    assertEquals(rows.get("u1")?.status, "applied");
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
