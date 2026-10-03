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
