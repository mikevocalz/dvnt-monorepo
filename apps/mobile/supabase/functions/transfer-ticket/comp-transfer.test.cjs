// Offline endpoint contracts over a stateful PostgREST-shaped fixture. No live
// ticket issuance, emails, wallets, or transfers. HMAC signing/verification is real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { harness: edgeHarness } = require('../_shared/payment-safety.test.cjs');

function moduleCode(filename) {
  return ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const qr = {};
vm.runInNewContext(moduleCode(path.resolve(__dirname, '../_shared/hmac-qr.ts')), {
  exports: qr, crypto, TextEncoder, btoa, atob, console,
  Deno: { env: { get: () => 'offline-fixture-secret' } },
});

function fixture(options = {}) {
  const tables = {
    tickets: [1, 2, 3].map(i => ({ id: `comp-${i}`, event_id: 7, user_id: 'sender',
      ticket_type_id: 'tier', purchase_amount_cents: 0, status: 'active', checked_in_at: null,
      qr_token: `original-token-${i}`, qr_payload: null, guest_lookup_token: `00000000-0000-4000-8000-00000000000${i}`,
      attendee_name: 'Old holder', guest_email: 'old@example.test', guest_phone: '+12125550000', ...options.ticket })),
    ticket_transfers: [], notifications: [], push_tokens: [],
    user: ['sender', 'one', 'two', 'three', 'other'].map(id => ({ id, username: id })),
    users: ['sender', 'one', 'two', 'three', 'other'].map((id, i) => ({ id: i + 1, username: id, auth_id: id })), order_addons: [],
    events: [{ id: 7, host_id: 'staff', start_date: new Date(Date.now() + 7 * 864e5).toISOString(), ...options.event }],
    ticket_types: [{ id: 'tier', name: 'GA' }],
  };
  const writes = [], wallets = [], rpcCalls = [], warnings = [], receipts = [], directEmails = [];
  let sequence = 0, beforeWrite = options.beforeWrite;
  const db = {
    from(table) {
      let payload, operation = 'select', limit = Infinity;
      const filters = [];
      const q = {
        select() { return q; }, limit(n) { limit = n; return q; },
        eq(k, v) { filters.push(row => row[k] === v); return q; },
        ilike(k, v) { filters.push(row => String(row[k]).toLowerCase() === v.replace(/\\_/g, '_').toLowerCase()); return q; },
        is(k, v) { filters.push(row => row[k] === v); return q; },
        in(k, vs) { filters.push(row => vs.includes(row[k])); return q; },
        update(p) { operation = 'update'; payload = p; return q; },
        insert(p) { operation = 'insert'; payload = p; return q; },
        result(single = false) {
          if (options.throwOn?.({table, operation, tables})) throw Error('private-recipient-sentinel');
          if (operation !== 'select') {
            beforeWrite?.({ table, operation, payload, tables });
            writes.push({ table, operation, payload });
          }
          if (table === 'notifications' && operation === 'insert') {
            if ('sender_id' in payload) return { data: null, error: { code: 'PGRST204' } };
            if (payload.entity_type != null && !['post','comment','story','user','message','event','lynk_room'].includes(payload.entity_type)) return { data: null, error: { code: '22P02' } };
            if (options.notificationError) return { data: null, error: { code: 'XX001' } };
          }
          if (table === options.lookupErrorTable && operation === 'select') return { data: null, error: { message: 'lookup unavailable' } };
          if (operation === 'insert' && options.insertError) {
            if (options.insertCommitted) tables[table].push({ id: `transfer-${++sequence}`, ...payload });
            return { data: null, error: { message: 'insert failed' } };
          }
          const rows = operation === 'insert'
            ? [{ id: `transfer-${++sequence}`, ...payload }]
            : (tables[table] || []).filter(row => filters.every(f => f(row))).slice(0, limit);
          if (operation === 'insert') tables[table].push(...rows);
          if (operation === 'update') rows.forEach(row => Object.assign(row, payload));
          const snapshots = rows.map(row => table === 'ticket_transfers'
            ? { ...row, tickets: { ...tables.tickets.find(t => t.id === row.ticket_id) } }
            : { ...row });
          return { data: single ? snapshots[0] ?? null : snapshots, error: null };
        },
        single: async () => q.result(true), maybeSingle: async () => q.result(true),
        then(resolve, reject) { return Promise.resolve(q.result()).then(resolve, reject); },
      };
      return q;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'accept_ticket_transfer_with_receipt') {
        const transfer = tables.ticket_transfers.find(t => t.id === args.p_transfer_id);
        const ticket = tables.tickets.find(t => t.id === transfer?.ticket_id);
        beforeWrite?.({ table: 'ticket_transfers', operation: 'update', payload: { status: 'accepted' }, tables });
        if (options.acceptanceError && !options.acceptanceCommitted) return { data: null, error: { message: 'transaction rolled back' } };
        if (!transfer || transfer.to_user_id !== args.p_recipient_id || transfer.status !== 'pending' ||
          !ticket || ticket.user_id !== transfer.from_user_id || ticket.status !== 'transfer_pending' || ticket.checked_in_at || ticket.event_id !== args.p_event_id) {
          return { data: { ok: false, error: 'Ticket or transfer unavailable' }, error: null };
        }
        const patch = { user_id: args.p_recipient_id, status: 'active', qr_token: args.p_qr_token, qr_payload: args.p_qr_payload,
          transferred_from: transfer.from_user_id, attendee_name: null, guest_name: null, guest_email: null,
          guest_phone: null, guest_lookup_token: null, wallet_serial_number: null, wallet_auth_token: null,
          wallet_pass_type_id: null, wallet_voided_at: null, wallet_last_pushed_at: null };
        Object.assign(ticket, patch); Object.assign(transfer, { status: 'accepted', resolved_at: new Date().toISOString() });
        writes.push({ table: 'tickets', operation: 'update', payload: patch });
        return options.acceptanceError ? { data: null, error: { message: 'response lost after commit' } } : { data: { ok: true, ticket_id: ticket.id, receipt_ids: [`receipt-${transfer.id}`] }, error: null };
      }
      assert.equal(name, 'redeem_ticket');
      const t = tables.tickets.find(t => t.qr_token === args.p_qr_token);
      if (!t) return { data: { result: 'invalid' }, error: null };
      if (t.event_id !== args.p_event_id) return { data: { result: 'wrong_event' }, error: null };
      if (t.status !== 'active') return { data: { result: t.status === 'scanned' ? 'already_scanned' : 'not_active', ticketStatus: t.status }, error: null };
      t.status = 'scanned'; t.checked_in_at = new Date().toISOString();
      return { data: { result: 'valid', ticketId: t.id, eventId: t.event_id, ticketStatus: t.status }, error: null };
    },
  };
  let handler;
  const stubs = {
    'verify-session.ts': { verifySession: async (_db, req) => req.headers.get('test-user') },
    'hmac-qr.ts': qr,
    'wallet-push.ts': { voidWalletPass: async (_db, id, owner) => { assert.equal(owner, 'sender'); wallets.push(id); } },
    'send-resend-email.ts': { sendResendEmail: async () => { directEmails.push(true); return 'email'; }, ticketConfirmation: () => ({}) },
    'ticket-receipt-delivery.ts': { deliverTicketReceipts: async (client, ids) => { assert.equal(client, db); receipts.push([...ids]); if (options.receiptError) throw Error('mail unavailable'); } },
  };
  vm.runInNewContext(moduleCode(path.resolve(__dirname, 'index.ts')), {
    exports: {}, Response, Request, crypto, console: { log() {}, error() {}, warn(...args) { warnings.push(args); } },
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    fetch: async () => { throw Error('No external side effects permitted'); },
    require: name => name.includes('supabase-js') ? { createClient: () => db } : stubs[path.basename(name)],
  });
  return {
    tables, writes, wallets, rpcCalls, warnings, receipts, directEmails,
    setBeforeWrite(fn) { beforeWrite = fn; },
    async invoke(user, body) {
      return handler(new Request('http://offline.test', { method: 'POST', headers: user ? { 'test-user': user } : {}, body: JSON.stringify(body) }));
    },
    async scan(body) {
      return edgeHarness({ database: db, dependencyOverrides: { 'hmac-qr.ts': qr } }).invoke('ticket-scan', { event_id: 7, ...body });
    },
    async guest(token) {
      return edgeHarness({ database: db, dependencyOverrides: { 'ticket-addons.ts': { loadTicketAddons: async () => [] } } }).invoke('get-guest-ticket', { token });
    },
  };
}
async function initiate(f, i, to) {
  const res = await f.invoke('sender', { action: 'initiate', ticket_id: `comp-${i}`, to_username: to });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()).transfer_id;
}

test('all three zero-price comps transfer independently; each old raw QR and guest link is revoked', async () => {
  const f = fixture();
  for (const [index, to] of ['one', 'two', 'three'].entries()) {
    const t = f.tables.tickets[index];
    const oldToken = t.qr_token, oldLink = t.guest_lookup_token;
    const id = await initiate(f, index + 1, to);
    assert.equal(t.status, 'transfer_pending');
    const res = await f.invoke(to, { action: 'accept', transfer_id: id });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(t.user_id, to); assert.equal(t.status, 'active');
    assert.equal(t.purchase_amount_cents, 0); assert.equal(t.transferred_from, 'sender');
    assert.notEqual(t.qr_token, oldToken); assert.ok(t.qr_payload);
    assert.equal(t.guest_lookup_token, null); assert.equal(t.guest_email, null); assert.equal(t.attendee_name, null);
    assert.equal((await f.guest(oldLink)).status, 404);
    assert.equal((await (await f.scan({ qr_token: oldToken })).json()).valid, false);
  }
  assert.equal(new Set(f.tables.tickets.map(t => t.qr_token)).size, 3);
  assert.equal(new Set(f.tables.tickets.map(t => t.qr_payload)).size, 3);
  assert.equal(f.wallets.length, 3);
  for (const t of f.tables.tickets) {
    assert.equal((await (await f.scan({ qr_payload: t.qr_payload })).json()).valid, true);
    assert.equal((await (await f.scan({ qr_payload: t.qr_payload })).json()).valid, false);
  }
});

test('original unsigned comp tokens still redeem', async () => {
  const f = fixture();
  const result = await (await f.scan({ qr_token: f.tables.tickets[0].qr_token })).json();
  assert.equal(result.valid, true);
});

test('a valid old signed QR cannot redeem the current owner\'s credential after transfer', async () => {
  const f = fixture();
  const old = await qr.createSignedQrPayload('comp-1', 7);
  Object.assign(f.tables.tickets[0], { qr_token: old.qrToken, qr_payload: old.qrPayload });
  assert.equal((await qr.verifySignedQrPayload(old.qrPayload)).valid, true);
  const id = await initiate(f, 1, 'one');
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 200);
  const stale = await (await f.scan({ qr_payload: old.qrPayload })).json();
  assert.equal(stale.valid, false); assert.equal(f.tables.tickets[0].status, 'active');
  assert.ok(!f.rpcCalls.some(c => c.name === 'redeem_ticket' && c.args.p_qr_token === f.tables.tickets[0].qr_token));
  assert.equal((await (await f.scan({ qr_payload: f.tables.tickets[0].qr_payload })).json()).valid, true);
});

for (const [user, status] of [[null, 401], ['other', 403]]) test(`comp initiation requires authenticated owner (${user})`, async () => {
  const f = fixture();
  assert.equal((await f.invoke(user, { action: 'initiate', ticket_id: 'comp-1', to_username: 'one' })).status, status);
  assert.equal(f.writes.length, 0);
});
for (const status of ['scanned', 'refunded', 'void', 'transfer_pending']) test(`cannot transfer a ${status} comp`, async () => {
  const f = fixture({ ticket: { status } });
  assert.equal((await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-1', to_username: 'one' })).status, 400);
  assert.equal(f.writes.length, 0);
});

test('only named recipient accepts; self-transfer and already-ticketed recipient remain refused', async () => {
  const f = fixture();
  assert.equal((await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-1', to_username: 'sender' })).status, 400);
  const id = await initiate(f, 1, 'one');
  assert.equal((await f.invoke('other', { action: 'accept', transfer_id: id })).status, 403);
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 200);
  assert.equal((await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-2', to_username: 'one' })).status, 409);
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 400);
  assert.equal(f.tables.tickets[1].user_id, 'sender');
});

for (const action of ['cancel', 'decline']) test(`${action} restores only its comp and enforces sender/recipient`, async () => {
  const f = fixture(); const id = await initiate(f, 1, 'one');
  const user = action === 'cancel' ? 'sender' : 'one';
  assert.equal((await f.invoke('other', { action, transfer_id: id })).status, 403);
  assert.equal((await f.invoke(user, { action, transfer_id: id })).status, 200);
  assert.equal(f.tables.tickets[0].status, 'active'); assert.equal(f.tables.tickets[0].user_id, 'sender');
  assert.equal(f.tables.tickets[1].qr_token, 'original-token-2');
});

test('event-expired initiation and failed transfer insert do not strand the comp or void its wallet', async () => {
  for (const opts of [{ event: { start_date: '2020-01-01T00:00:00Z' } }, { event: { start_date: 'invalid' } }, { insertError: true }]) {
    const f = fixture(opts);
    const r = await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-1', to_username: 'one' });
    assert.equal(r.status, opts.insertError ? 500 : 400);
    assert.equal(f.tables.tickets[0].status, 'active'); assert.equal(f.wallets.length, 0);
  }
});

for (const action of ['accept', 'cancel', 'decline', 'expire']) {
  for (const status of ['refunded', 'scanned', 'void']) test(`${action} cannot resurrect a ${status} comp`, async () => {
    const f = fixture(); const id = await initiate(f, 1, 'one');
    if (action === 'expire') f.tables.ticket_transfers[0].expires_at = '2020-01-01T00:00:00Z';
    f.setBeforeWrite(({ table, payload, tables }) => {
      if (table === 'ticket_transfers' && payload.status !== 'pending') tables.tickets[0].status = status;
    });
    const r = await f.invoke(action === 'cancel' ? 'sender' : 'one', { action: action === 'expire' ? 'accept' : action, transfer_id: id });
    assert.ok([200, 400, 409].includes(r.status), await r.clone().text());
    assert.equal(f.tables.tickets[0].status, status); assert.equal(f.tables.tickets[0].user_id, 'sender');
  });
}

test('expired transfer only releases its pending comp and cannot be accepted again', async () => {
  const f = fixture(); const id = await initiate(f, 1, 'one');
  f.tables.ticket_transfers[0].expires_at = '2020-01-01T00:00:00Z';
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 400);
  assert.equal(f.tables.tickets[0].status, 'active'); assert.equal(f.tables.ticket_transfers[0].status, 'expired');
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 400);
});


test('uncertain transfer insertion does not release a committed pending transfer', async () => {
  const f = fixture({ insertError: true, insertCommitted: true });
  assert.equal((await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-1', to_username: 'one' })).status, 500);
  assert.equal(f.tables.tickets[0].status, 'transfer_pending');
  assert.equal(f.tables.ticket_transfers[0].status, 'pending');
});

test('concurrent acceptance of one comp moves it once and leaves its siblings untouched', async () => {
  const f = fixture(); const id = await initiate(f, 1, 'one');
  const replies = await Promise.all(Array.from({ length: 8 }, () => f.invoke('one', { action: 'accept', transfer_id: id })));
  assert.equal(replies.filter(r => r.status === 200).length, 1);
  assert.ok(replies.filter(r => r.status !== 200).every(r => [400, 409].includes(r.status)));
  assert.equal(f.writes.filter(w => w.table === 'tickets' && w.payload.user_id === 'one').length, 1);
  assert.equal(f.tables.tickets[1].user_id, 'sender'); assert.equal(f.tables.tickets[2].user_id, 'sender');
});


test('atomic acceptance failure remains pending and can be retried without a stranded comp', async () => {
  const options = { acceptanceError: true };
  const f = fixture(options); const id = await initiate(f, 1, 'one');
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 503);
  assert.equal(f.tables.ticket_transfers[0].status, 'pending');
  assert.equal(f.tables.tickets[0].status, 'transfer_pending');
  assert.equal(f.tables.tickets[0].user_id, 'sender');
  options.acceptanceError = false;
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 200);
  assert.equal(f.tables.tickets[0].user_id, 'one');
});

test('an acceptance response lost after commit never restores a moved comp to pending', async () => {
  const f = fixture({ acceptanceError: true, acceptanceCommitted: true });
  const id = await initiate(f, 1, 'one');
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 503);
  assert.equal(f.tables.ticket_transfers[0].status, 'accepted');
  assert.equal(f.tables.tickets[0].status, 'active');
  assert.equal(f.tables.tickets[0].user_id, 'one');
  assert.equal((await f.invoke('one', { action: 'accept', transfer_id: id })).status, 400);
});

test('current profile handle resolves linked auth ID even when auth username is stale', async () => {
  const f = fixture();
  f.tables.user.find(u => u.id === 'one').username = 'old-handle';
  const id = await initiate(f, 1, ' @ONE ');
  assert.equal(f.tables.ticket_transfers.find(t => t.id === id).to_user_id, 'one');
});

test('reused profile handle never falls back to a different stale auth username', async () => {
  const f = fixture();
  f.tables.user.find(u => u.id === 'other').username = 'one';
  const id = await initiate(f, 1, 'one');
  assert.equal(f.tables.ticket_transfers.find(t => t.id === id).to_user_id, 'one');
});

for (const scenario of ['missing-profile', 'unlinked-profile', 'deleted-auth', 'malformed', 'lookup-error']) {
  test(`recipient ${scenario} fails closed before ticket writes`, async () => {
    const f = fixture(scenario === 'lookup-error' ? { lookupErrorTable: 'users' } : {});
    if (scenario === 'missing-profile') f.tables.users = f.tables.users.filter(u => u.username !== 'one');
    if (scenario === 'unlinked-profile') f.tables.users.find(u => u.username === 'one').auth_id = null;
    if (scenario === 'deleted-auth') f.tables.user = f.tables.user.filter(u => u.id !== 'one');
    const response = await f.invoke('sender', { action: 'initiate', ticket_id: 'comp-1', to_username: scenario === 'malformed' ? {} : 'one' });
    assert.equal(response.status, scenario === 'lookup-error' ? 503 : scenario === 'malformed' ? 400 : 404);
    assert.equal(f.tables.tickets[0].status, 'active');
    assert.equal(f.writes.length, 0); assert.equal(f.wallets.length, 0);
  });
}

 test('mixed-case canonical handles and literal underscores resolve exactly', async () => {
  const f = fixture();
  f.tables.users.find(u => u.auth_id === 'one').username = 'Mixed_Handle';
  f.tables.users.find(u => u.auth_id === 'other').username = 'mixedXhandle';
  const id = await initiate(f, 1, '@MIXED_HANDLE');
  assert.equal(f.tables.ticket_transfers.find(t => t.id === id).to_user_id, 'one');
});

for (const action of ['accept', 'decline', 'cancel']) {
  test(`transfer notification survives actual schema and routes ${action} to the correct account once`, async () => {
    const f = fixture();
    const id = await initiate(f, 1, 'one');
    assert.equal(f.tables.notifications.length, 1);
    const invitation = f.tables.notifications[0];
    assert.equal(invitation.recipient_id, 2);
    assert.equal(invitation.actor_id, 1);
    assert.equal(invitation.entity_type, 'event');
    assert.equal(invitation.entity_id, '7');
    assert.equal(invitation.entity_payload.transfer_id, id);
    assert.equal(invitation.type, 'ticket_transfer_initiated');
    const user = action === 'cancel' ? 'sender' : 'one';
    assert.equal((await f.invoke(user, { action, transfer_id: id })).status, 200);
    assert.equal(f.tables.notifications.length, 2);
    const resolution = f.tables.notifications[1];
    assert.equal(resolution.recipient_id, action === 'cancel' ? 2 : 1);
    assert.equal(resolution.actor_id, action === 'cancel' ? 1 : 2);
    assert.equal(resolution.type, `ticket_transfer_${{accept:'accepted',decline:'declined',cancel:'cancelled'}[action]}`);
    assert.equal(resolution.entity_type, 'event');
    assert.equal(resolution.entity_id, '7');
    assert.equal(resolution.entity_payload.transfer_id, id);
    assert.notEqual((await f.invoke(user, { action, transfer_id: id })).status, 200);
    assert.equal(f.tables.notifications.length, 2, 'replay must not send a second resolution');
    assert.equal(f.tables.notifications.some(n => n.recipient_id === 5), false);
  });
}
test('a rejected feed insert is logged without falsely failing or replaying committed transfer', async () => {
  const f = fixture({notificationError:true});
  await initiate(f, 1, 'one');
  assert.equal(f.tables.tickets[0].status, 'transfer_pending');
  assert.equal(f.tables.notifications.length, 0);
  assert.ok(f.warnings.some(args => args[0].includes('notification insert failed') && args[1] === 'XX001'));
});

for (const action of ['accept','decline','cancel']) {
 for (const failure of ['notifications','users','events']) {
  test(`post-commit ${failure} transport failure never fails ${action} or leaks details`, async () => {
   let armed=false;
   const f=fixture({throwOn:({table})=>armed&&table===failure});
   const id=await initiate(f,1,'one');armed=true;
   const response=await f.invoke(action==='cancel'?'sender':'one',{action,transfer_id:id});
   assert.equal(response.status,200);
   assert.ok(!JSON.stringify(f.warnings).includes('private-recipient-sentinel'));
  });
 }
}
for(const failure of ['notifications','users','events']) {
 test(`post-commit ${failure} transport failure never fails initiation`,async()=>{
  const f=fixture({throwOn:({table,tables})=>tables.ticket_transfers.length>0&&table===failure});
  await initiate(f,1,'one');assert.equal(f.tables.tickets[0].status,'transfer_pending');
  assert.ok(!JSON.stringify(f.warnings).includes('private-recipient-sentinel'));
 });
}

for (const receiptError of [false, true]) test(`receipt processing is acceptance-only and does not change ownership outcome (${receiptError})`, async () => {
 const f = fixture({receiptError});
 const id = await initiate(f, 1, 'one');
 assert.deepEqual(f.receipts, []);
 assert.equal((await f.invoke('other', {action:'accept',transfer_id:id})).status, 403);
 assert.deepEqual(f.receipts, []);
 assert.equal((await f.invoke('one', {action:'accept',transfer_id:id})).status, 200);
 assert.equal(f.tables.tickets[0].user_id,'one');
 assert.deepEqual(f.receipts, [[`receipt-${id}`]]);
 assert.deepEqual(f.directEmails, []);
 assert.notEqual((await f.invoke('one', {action:'accept',transfer_id:id})).status, 200);
 assert.equal(f.receipts.length, 1);
});
