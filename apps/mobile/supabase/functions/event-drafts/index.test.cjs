const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as create-event/index.test.cjs. `events` holds the rows the
// handler may look up; every insert is recorded so a test can read what landed.
function harness(events = []) {
  let handler;
  const inserts = [];
  const client = {
    from: (table) => {
      const filters = {};
      let payload;
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: (key, value) => { filters[key] = value; return query; },
        insert: (value) => { payload = value; return query; },
        maybeSingle: async () => {
          if (table !== 'events') return { data: null };
          return { data: events.find((row) => row.id === filters.id) || null };
        },
        single: async () => {
          inserts.push({ table, payload });
          // Mirrors the FK: source_event_id must name a real event or be null.
          if (payload.source_event_id != null && !events.some((e) => e.id === payload.source_event_id)) {
            return { data: null, error: { code: '23503' } };
          }
          return { data: { id: 'draft-1', ...payload } };
        },
      };
      return query;
    },
  };
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/index.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, error() {} }, Response, TextEncoder,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => name.includes('supabase-js') ? { createClient: () => client } : {
      verifySession: async () => 'host-a',
      jsonResponse: (body) => json(body),
      errorResponse: (message, status) => json({ ok: false, error: { message } }, status),
      optionsResponse: () => new Response(null, { status: 204 }),
    },
  });
  const save = async (payload) => {
    const res = await handler(new Request('http://test', {
      method: 'POST', body: JSON.stringify({ action: 'save', payload }),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { save, inserts };
}

test('a fresh draft with draftSourceEventId null saves with no source event', async () => {
  // The store default is null, and Number(null) is 0, which used to be written
  // as source_event_id 0 and fail the foreign key on every new draft.
  const h = harness();
  const got = await h.save({ title: 'Cookout', draftSourceEventId: null });
  assert.equal(got.status, 200);
  assert.equal(h.inserts[0].payload.source_event_id, null);
});

test("another host's event id is not recorded as this draft's source", async () => {
  const h = harness([{ id: 42, host_id: 'host-b' }]);
  const got = await h.save({ title: 'Cookout', draftSourceEventId: 42 });
  assert.equal(got.status, 200);
  assert.equal(h.inserts[0].payload.source_event_id, null);
});

test("the caller's own event is kept as the source", async () => {
  const h = harness([{ id: 42, host_id: 'host-a' }]);
  const got = await h.save({ title: 'Cookout (Copy)', draftSourceEventId: 42 });
  assert.equal(got.status, 200);
  assert.equal(h.inserts[0].payload.source_event_id, 42);
});

// A table-backed fake for duplicate_event and copy_promo_codes. Supports the
// filters those paths use (eq, neq, in) and records every insert.
function tableHarness(tables) {
  let handler;
  const inserts = [];
  let nextId = 1;
  const client = {
    from: (table) => {
      const filters = [];
      let payload;
      const rows = () => (tables[table] || []).filter((row) => filters.every((f) => f(row)));
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        neq: (key, value) => { filters.push((row) => row[key] !== value); return query; },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
        insert: (value) => {
          payload = value;
          if (table === 'promo_codes') {
            const list = (tables.promo_codes = tables.promo_codes || []);
            const clash = list.some((r) => r.event_id === value.event_id
              && String(r.code).toUpperCase() === String(value.code).toUpperCase());
            if (clash) return Promise.resolve({ error: { code: '23505' } });
            list.push({ id: `promo-${nextId++}`, ...value });
            inserts.push({ table, payload: value });
            return Promise.resolve({ error: null });
          }
          return query;
        },
        maybeSingle: async () => ({ data: rows()[0] || null }),
        single: async () => {
          inserts.push({ table, payload });
          return { data: { id: 'draft-1', revision: 1, ...payload } };
        },
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return query;
    },
  };
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/index.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, error() {} }, Response, TextEncoder,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => name.includes('supabase-js') ? { createClient: () => client } : {
      verifySession: async () => 'host-a',
      jsonResponse: (body) => json(body),
      errorResponse: (message, status) => json({ ok: false, error: { message } }, status),
      optionsResponse: () => new Response(null, { status: 204 }),
    },
  });
  const call = async (body) => {
    const res = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { call, inserts, tables };
}

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const promo = (over) => ({
  event_id: 42, ticket_type_id: null, code: 'SAVE10', discount_type: 'percent', discount_value: 10,
  max_uses: null, uses_count: 0, valid_from: null, valid_until: null, max_per_user: null, ...over,
});
function eventsWithCodes(codes) {
  return {
    events: [
      { id: 42, host_id: 'host-a', title: 'Cookout', start_date: '2026-11-01T01:00:00Z', event_tz: 'America/Los_Angeles' },
      { id: 77, host_id: 'host-a', title: 'Cookout (Copy)' },
      { id: 99, host_id: 'host-b', title: 'Not yours' },
    ],
    ticket_types: [
      { id: 'tier-vip-old', event_id: 42, name: 'VIP' },
      { id: 'tier-vip-new', event_id: 77, name: 'VIP' },
    ],
    promo_codes: codes,
  };
}

test('a duplicated draft carries the source event_tz', async () => {
  const h = tableHarness(eventsWithCodes([]));
  const got = await h.call({ action: 'duplicate_event', eventId: 42 });
  assert.equal(got.status, 200);
  assert.equal(got.body.draft.payload.eventTz, 'America/Los_Angeles');
});

test('eventTz survives a draft save', async () => {
  const h = tableHarness(eventsWithCodes([]));
  const got = await h.call({ action: 'save', payload: { title: 'Cookout (Copy)', eventTz: 'America/Los_Angeles' } });
  assert.equal(got.status, 200);
  assert.equal(h.inserts.at(-1).payload.payload.eventTz, 'America/Los_Angeles');
});

test('the duplicated draft lists the source promo codes with their state', async () => {
  const h = tableHarness(eventsWithCodes([
    promo({ code: 'SAVE10' }),
    promo({ code: 'OLD', valid_until: PAST }),
    promo({ code: 'GONE', max_uses: 5, uses_count: 5 }),
    promo({ code: 'VIPONLY', ticket_type_id: 'tier-vip-old' }),
  ]));
  const got = await h.call({ action: 'duplicate_event', eventId: 42 });
  const list = got.body.draft.payload.promoCodeTemplates;
  assert.deepEqual(list.map((p) => [p.code, p.active]), [
    ['SAVE10', true], ['OLD', false], ['GONE', false], ['VIPONLY', true],
  ]);
  assert.equal(list[3].ticketTierName, 'VIP');
});

test('copy_promo_codes copies standalone codes onto the new event, inactive ones as inactive', async () => {
  const h = tableHarness(eventsWithCodes([
    promo({ code: 'SAVE10', uses_count: 3, max_uses: 50 }),
    promo({ code: 'OLD', valid_until: PAST }),
    promo({ code: 'GONE', max_uses: 5, uses_count: 5, valid_until: FUTURE }),
    promo({ code: 'VIPONLY', ticket_type_id: 'tier-vip-old' }),
  ]));
  const got = await h.call({ action: 'copy_promo_codes', eventId: 77, sourceEventId: 42 });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.copied, [
    { code: 'SAVE10', active: true }, { code: 'OLD', active: false },
    { code: 'GONE', active: false }, { code: 'VIPONLY', active: true },
  ]);
  const onNew = h.tables.promo_codes.filter((r) => r.event_id === 77);
  const byCode = Object.fromEntries(onNew.map((r) => [r.code, r]));
  assert.equal(byCode.SAVE10.uses_count, 0);
  assert.equal(byCode.SAVE10.max_uses, 50);
  assert.equal(byCode.OLD.valid_until, PAST);
  // Use count resets on the copy, so a fully redeemed code is closed by date.
  assert.ok(new Date(byCode.GONE.valid_until) <= new Date());
  assert.equal(byCode.VIPONLY.ticket_type_id, 'tier-vip-new');
  assert.ok(onNew.every((r) => r.created_by === 'host-a'));
});

test('copy_promo_codes is idempotent', async () => {
  const h = tableHarness(eventsWithCodes([promo({ code: 'SAVE10' }), promo({ code: 'late' })]));
  await h.call({ action: 'copy_promo_codes', eventId: 77, sourceEventId: 42 });
  const again = await h.call({ action: 'copy_promo_codes', eventId: 77, sourceEventId: 42 });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.copied, []);
  assert.deepEqual(again.body.kept, ['SAVE10', 'late']);
  assert.equal(h.tables.promo_codes.filter((r) => r.event_id === 77).length, 2);
});

test('a tier code with no matching tier on the new event is skipped, never widened', async () => {
  const tables = eventsWithCodes([promo({ code: 'VIPONLY', ticket_type_id: 'tier-vip-old' })]);
  tables.ticket_types = tables.ticket_types.filter((t) => t.event_id !== 77);
  const h = tableHarness(tables);
  const got = await h.call({ action: 'copy_promo_codes', eventId: 77, sourceEventId: 42 });
  assert.deepEqual(got.body.skipped, [{ code: 'VIPONLY', reason: 'ticket_tier_missing' }]);
  assert.equal(h.tables.promo_codes.filter((r) => r.event_id === 77).length, 0);
});

test("copy_promo_codes refuses events the caller does not host", async () => {
  const h = tableHarness(eventsWithCodes([promo({ code: 'SAVE10' })]));
  assert.equal((await h.call({ action: 'copy_promo_codes', eventId: 99, sourceEventId: 42 })).status, 404);
  assert.equal((await h.call({ action: 'copy_promo_codes', eventId: 77, sourceEventId: 99 })).status, 404);
  assert.equal(h.tables.promo_codes.length, 1);
});
