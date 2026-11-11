const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(`${__dirname}/addons.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(results) {
  const calls = []; const exports = {};
  const db = { from(table) {
    const c = { table, filters: [] }; calls.push(c);
    const q = { then(resolve) { assert.ok(results.length, 'unexpected DB call'); return Promise.resolve(results.shift()).then(resolve); } };
    for (const method of ['select', 'insert', 'update', 'delete', 'order', 'abortSignal', 'single']) q[method] = (...args) => { c[method] = args; return q; };
    for (const method of ['eq', 'in']) q[method] = (...args) => { c.filters.push([method, ...args]); return q; };
    return q;
  }};
  vm.runInNewContext(source, { exports, console: { error() {} }, AbortSignal, AbortController,
    setTimeout: () => 0, require: name => name.includes('supabase/client') ? { supabase: db } : { ensureSupabaseJwt: async () => {} },
  });
  return { ...exports, calls, results };
}
const ok = (data = [{ id: 'row' }]) => ({ data, error: null });
const denied = { data: null, error: { code: '42501', message: 'forbidden' } };
const variant = (id) => ({ ...(id ? { id } : {}), name: 'Small', optionValues: { size: 'S' } });
const params = { eventId: '42', name: 'Shirt', addonType: 'merch', bindingMode: 'standalone', priceCents: 2000 };

test('catalog read distinguishes empty success from errors', async () => {
  assert.equal((await harness([ok([])]).addonsApi.getByEvent('42')).length, 0);
  await assert.rejects(harness([denied]).addonsApi.getByEvent('42'), e => e.code === '42501');
});
for (const method of ['update', 'remove']) test(`${method} requires confirmed affected row`, async () => {
  for (const result of [ok([]), denied]) {
    const h = harness([result]); await assert.rejects(h.addonsApi[method]('addon', { name: 'New' }));
    assert.equal(h.calls.length, 1);
  }
  assert.equal(await harness([ok()]).addonsApi[method]('addon', { name: 'New' }), true);
});
test('remove only soft-retires FK conflicts and confirms fallback update', async () => {
  const fk = { data: null, error: { code: '23503' } };
  const h = harness([fk, ok()]); assert.equal(await h.addonsApi.remove('addon'), true);
  assert.equal(h.calls[1].update[0].status, 'ended');
  await assert.rejects(harness([fk, ok([])]).addonsApi.remove('addon'));
  const offline = harness([{ error: { code: 'offline' } }]);
  await assert.rejects(offline.addonsApi.remove('addon')); assert.equal(offline.calls.length, 1);
});
test('foreign variant IDs fail before deleting or updating any variant', async () => {
  const h = harness([ok([{ id: 'own' }])]);
  await assert.rejects(h.addonsApi.syncVariants('addon', [variant('foreign')]), /does not belong/);
  assert.equal(h.calls.length, 1);
});
test('variant updates and deletes are parent-scoped and zero-row writes fail', async () => {
  const h = harness([ok([{ id: 'own' }]), ok(), ok()]);
  assert.equal(await h.addonsApi.syncVariants('addon', [variant('own')]), true);
  assert.ok(h.calls[1].filters.some(f => f[1] === 'addon_id' && f[2] === 'addon'));
  await assert.rejects(harness([ok([{ id: 'own' }]), ok([])]).addonsApi.syncVariants('addon', [variant('own')]));
  const del = harness([ok([{ id: 'own' }]), ok(), ok()]);
  assert.equal(await del.addonsApi.syncVariants('addon', []), true);
  assert.ok(del.calls[1].filters.some(f => f[1] === 'addon_id' && f[2] === 'addon'));
  await assert.rejects(harness([ok([{ id: 'own' }]), ok([])]).addonsApi.syncVariants('addon', []));
});
test('variant insert and parent flag require affected rows, with permission errors propagated', async () => {
  for (const failed of [ok([]), denied]) {
    await assert.rejects(harness([ok([]), failed]).addonsApi.syncVariants('addon', [variant()]));
    await assert.rejects(harness([ok([]), ok(), failed]).addonsApi.syncVariants('addon', [variant()]));
  }
  assert.equal(await harness([ok([]), ok(), ok()]).addonsApi.syncVariants('addon', [variant()]), true);
});
test('partial variant creation reports persisted parent ID, full success unchanged', async () => {
  for (const failed of [denied, ok([])]) {
    const h = harness([ok({ id: 'persisted-addon' }), failed]);
    await assert.rejects(h.addonsApi.create({ ...params, variants: [variant()] }), e => {
      assert.equal(e.name, 'AddonCreatePartialError'); assert.equal(e.addonId, 'persisted-addon'); assert.ok(e.cause); return true;
    });
  }
  const h = harness([ok({ id: 'created' }), ok()]);
  assert.equal((await h.addonsApi.create({ ...params, variants: [variant()] })).id, 'created');
  assert.equal((await harness([ok({ id: 'simple' })]).addonsApi.create(params)).id, 'simple');
  await assert.rejects(harness([denied]).addonsApi.create(params), e => e.code === '42501');
});

test('create returns confirmed variant rows for draft ID reconciliation', async () => {
  const rows = [{ id: 'new-v', addon_id: 'created', name: 'Small', sort_order: 0 }];
  const h = harness([ok({ id: 'created' }), ok(rows)]);
  const result = await h.addonsApi.create({ ...params, variants: [variant()] });
  assert.equal(result.ticket_addon_variants[0].id, 'new-v');
  assert.equal(h.calls[1].select[0], '*');
});
test('confirmed inserted IDs reach the draft before a sibling insert fails; retry updates them', async () => {
  const draft = [variant(), variant()]; const persisted = [];
  const h = harness([ok([]), ok([{ id: 'saved-v', addon_id: 'addon' }]), denied]);
  await assert.rejects(h.addonsApi.syncVariants('addon', draft, (index, row) => {
    persisted.push(row.id); draft[index].id = row.id;
  }));
  assert.deepEqual(persisted, ['saved-v']);
  assert.equal(draft[0].id, 'saved-v'); assert.equal(draft[1].id, undefined);
  const retry = harness([ok([{ id: 'saved-v' }]), ok([{ id: 'saved-v' }]), ok([{ id: 'second-v' }]), ok()]);
  assert.equal(await retry.addonsApi.syncVariants('addon', draft, (index, row) => { draft[index].id = row.id; }), true);
  assert.ok(retry.calls[1].update); assert.equal(retry.calls.filter(c => c.insert).length, 1);
  assert.equal(draft[1].id, 'second-v');
});
test('inserted ID is retained when final parent flag update fails', async () => {
  const persisted = []; const h = harness([ok([]), ok([{ id: 'saved-v' }]), denied]);
  await assert.rejects(h.addonsApi.syncVariants('addon', [variant()], (i, row) => persisted.push([i, row.id])));
  assert.deepEqual(persisted, [[0, 'saved-v']]);
});
