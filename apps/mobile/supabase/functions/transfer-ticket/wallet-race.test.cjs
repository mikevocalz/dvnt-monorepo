// Exercise the real Wallet helper without APNs or any external state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../_shared/wallet-push.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, console: { log() {} } });

function fixture(race) {
  const ticket = { id: 'ticket', user_id: 'sender', status: 'transfer_pending', wallet_serial_number: 'sender-pass', wallet_pass_type_id: 'pass-type', wallet_voided_at: null };
  const pushes = [];
  const db = { from(table) {
    let patch; const filters = [];
    const q = {
      select() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
      update(value) { patch = value; return q; },
      result(single) {
        if (table === 'wallet_registrations') { pushes.push(Object.fromEntries(filters)); return { data: [], error: null }; }
        if (patch) race?.(ticket);
        if (!filters.every(([key, value]) => ticket[key] === value)) return { data: single ? null : [], error: null };
        if (patch) Object.assign(ticket, patch);
        return { data: single ? { ...ticket } : [{ ...ticket }], error: null };
      },
      single: async () => q.result(true), maybeSingle: async () => q.result(true),
      then(resolve, reject) { return Promise.resolve(q.result(false)).then(resolve, reject); },
    };
    return q;
  } };
  return { ticket, pushes, void: () => exportsObject.voidWalletPass(db, 'ticket', 'sender') };
}

test('pending sender Wallet pass is voided and only its original serial is notified', async () => {
  const f = fixture(); await f.void();
  assert.ok(f.ticket.wallet_voided_at);
  assert.deepEqual(f.pushes, [{ serial_number: 'sender-pass', pass_type_id: 'pass-type' }]);
});
for (const [label, race] of [
  ['acceptance and new recipient pass', ticket => Object.assign(ticket, { user_id: 'recipient', status: 'active', wallet_serial_number: 'recipient-pass' })],
  ['cancel or decline', ticket => { ticket.status = 'active'; }],
  ['new Wallet serial', ticket => { ticket.wallet_serial_number = 'replacement-pass'; }],
]) test(`delayed initiation cannot void a pass after ${label}`, async () => {
  const f = fixture(race); await f.void();
  assert.equal(f.ticket.wallet_voided_at, null);
  assert.deepEqual(f.pushes, []);
});
