// transfer-ticket accept: the add-ons bound to the ticket
// (order_addons.ticket_id, set at issuance since 20261009100200) move to the
// recipient with the ticket, and each unredeemed add-on QR is re-minted so
// the sender's screenshot stops working, as the ticket's own QR does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const TICKET = { id: 'tk1', user_id: 'sender', event_id: 7, status: 'transfer_pending',
  ticket_type_id: 'tier', guest_lookup_token: null };

function fakeDb(orderAddons) {
  const ops = [];
  return {
    ops,
    from(table) {
      const op = { table, operation: 'select', payload: null, eq: {}, in: {} };
      const q = {
        select: () => q,
        insert: (p) => { op.operation = 'insert'; op.payload = p; return q; },
        update: (p) => { op.operation = 'update'; op.payload = p; return q; },
        eq: (k, v) => { op.eq[k] = v; return q; },
        in: (k, v) => { op.in[k] = v; return q; },
        not: () => q, is: () => q,
        rows() {
          if (table === 'order_addons') {
            return orderAddons.filter((r) => Object.entries(op.eq).every(([k, v]) => r[k] === v)
              && Object.entries(op.in).every(([k, v]) => v.includes(r[k])));
          }
          return [];
        },
        single: async () => {
          ops.push(op);
          if (table === 'ticket_transfers' && op.operation === 'select') {
            return { data: { id: 'tr1', to_user_id: 'recipient', from_user_id: 'sender', status: 'pending',
              expires_at: new Date(Date.now() + 864e5).toISOString(), tickets: TICKET }, error: null };
          }
          if (table === 'ticket_transfers') return { data: { id: 'tr1' }, error: null };
          return { data: null, error: null };
        },
        maybeSingle: async () => { ops.push(op); return { data: null, error: null }; },
        then: (resolve, reject) => {
          ops.push(op);
          const data = op.operation === 'select' ? q.rows() : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

function load(db) {
  let handler;
  const minted = [];
  const stubs = {
    'verify-session.ts': { verifySession: async () => 'recipient' },
    'hmac-qr.ts': { createSignedQrPayload: async (id, eid) => {
      const qr = { qrToken: `tok-${minted.length}`, qrPayload: `pl-${id}-${eid}` };
      minted.push({ id, eid });
      return qr;
    } },
    'wallet-push.ts': { voidWalletPass: async () => {} },
    'send-resend-email.ts': { sendResendEmail: async () => {}, ticketConfirmation: () => ({}) },
  };
  const file = path.resolve(__dirname, 'index.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, Response, Request, URLSearchParams, crypto, console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    fetch: async () => Response.json({}),
    require: (name) => name.includes('supabase-js') ? { createClient: () => db } : stubs[path.basename(name)],
  });
  return { minted, accept: () => handler(new Request('http://test', { method: 'POST',
    body: JSON.stringify({ action: 'accept', transfer_id: 'tr1' }) })) };
}

test('accepting a transfer moves the ticket\'s live add-ons to the recipient', async () => {
  const addons = [
    { id: 'oa1', ticket_id: 'tk1', status: 'unfulfilled', qr_token: 'old1', event_id: 7 },
    { id: 'oa2', ticket_id: 'tk1', status: 'fulfilled', qr_token: null, event_id: 7 },
    { id: 'oa3', ticket_id: 'tk1', status: 'redeemed', qr_token: 'old3', event_id: 7 },
    { id: 'oa4', ticket_id: 'other', status: 'unfulfilled', qr_token: 'old4', event_id: 7 },
  ];
  const db = fakeDb(addons);
  const fn = load(db);
  const r = await fn.accept();
  assert.equal(r.status, 200, await r.clone().text());

  const moves = db.ops.filter((o) => o.table === 'order_addons' && o.operation === 'update');
  const moved = new Set(moves.map((o) => o.eq.id));
  assert.ok(moved.has('oa1') && moved.has('oa2'), `live add-ons did not move: ${JSON.stringify(moves)}`);
  assert.ok(!moved.has('oa3'), 'a redeemed add-on is history and stays with the sender');
  assert.ok(!moved.has('oa4'), 'an add-on bound to another ticket moved');
  for (const o of moves) {
    assert.equal(o.payload.user_id, 'recipient');
    assert.equal(o.payload.guest_email, null);
    assert.equal(o.eq.status, o.eq.id === 'oa1' ? 'unfulfilled' : 'fulfilled', 'the update must not overwrite a row redeemed meanwhile');
  }
  const oa1 = moves.find((o) => o.eq.id === 'oa1');
  assert.equal(oa1.payload.qr_token.startsWith('tok-'), true, 'the add-on QR was not re-minted');
  const oa2 = moves.find((o) => o.eq.id === 'oa2');
  assert.equal(oa2.payload.qr_token, undefined, 'a row without a QR must not gain one');
});
