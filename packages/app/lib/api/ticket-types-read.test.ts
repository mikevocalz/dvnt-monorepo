import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Exercise the actual API method with an isolated read-only Supabase fixture.
// Extracting this dependency-free method avoids booting native auth modules.
const source = readFileSync(new URL("./tickets.ts", import.meta.url), "utf8");
const start = source.indexOf("  async getTicketTypes(eventId: string) {");
const end = source.indexOf("\n  },", start) + "\n  },".length;
assert.ok(start > 0 && end > start);
const method = source.slice(start, end).replace("eventId: string", "eventId");

function fixture(result: { data: unknown; error: unknown }) {
  const reads: unknown[][] = [];
  const query = {
    select(columns: string) { reads.push(["select", columns]); return query; },
    eq(column: string, value: number) { reads.push(["eq", column, value]); return query; },
    order(column: string, options: unknown) { reads.push(["order", column, options]); return Promise.resolve(result); },
  };
  const supabase = { from(table: string) { reads.push(["from", table]); return query; } };
  const read = new Function("supabase", "console", `return ({${method}}).getTicketTypes;`)(supabase, { error() {} });
  return { read, reads };
}

test("getTicketTypes preserves failed reads as errors for the retry UI", async () => {
  const failure = { code: "NETWORK", message: "Fixture read failed" };
  const { read, reads } = fixture({ data: null, error: failure });
  await assert.rejects(read("42"), (error) => error === failure);
  assert.deepEqual(reads.slice(0, 3), [["from", "ticket_types"], ["select", "*"], ["eq", "event_id", 42]]);
});

test("a successful empty ticket read remains distinguishable from failure", async () => {
  assert.deepEqual(await fixture({ data: [], error: null }).read("42"), []);
});

test("successful ticket reads preserve authoritative row IDs and prices", async () => {
  const rows = [{ id: "11111111-1111-4111-8111-111111111111", price_cents: 2500 }];
  assert.equal(await fixture({ data: rows, error: null }).read("42"), rows);
});
