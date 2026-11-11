import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL('./ticket-types.ts', import.meta.url), 'utf8');
const method = source.match(/async getByEvent\(eventId: string, publicOnly = (?:true|false)\): Promise<TicketTypeRecord\[\]> \{[\s\S]*?\n  \},/)![0]
  .replace('eventId: string', 'eventId').replace(': Promise<TicketTypeRecord[]>', '');
function fixture() {
  const calls: string[] = [];
  const rows = [{ id: 'tier', name: 'GA', price_cents: 100 }];
  const query = { select() { return query; }, eq() { return query; }, order() { return { data: rows, error: null }; } };
  const supabase = { from(table: string) { calls.push(table); return query; } };
  const bridge = async () => { calls.push('bridge'); };
  const read = new Function('supabase', 'ensureBridgeAuth', `return ({${method}}).getByEvent`)(supabase, bridge);
  return { calls, rows, read };
}
test('anonymous/default buyers use safe catalog without starting authentication', async () => {
  const f = fixture(); assert.equal(await f.read('1'), f.rows);
  assert.deepEqual(f.calls, ['ticket_types_public']);
});
test('explicit buyer reads keep safe projection', async () => {
  const f = fixture(); await f.read('1', true); assert.deepEqual(f.calls, ['ticket_types_public']);
});
test('manager reads establish bridge auth before fetching secret-bearing rows', async () => {
  const f = fixture(); assert.equal(await f.read('1', false), f.rows);
  assert.deepEqual(f.calls, ['bridge', 'ticket_types']);
});
