// Door scans of HMAC-signed QR payloads. Add-on payloads are minted in
// _shared/cart-issuance.ts (prepareCartAddonRows) with a random id in the
// `tid` slot, so the scan must fall back to order_addons.qr_payload when the
// id is not a ticket, then redeem through the redeem_addon CAS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

const EVENT_ID = 7;
const ADDON = { id: 'oa-1', event_id: EVENT_ID, qr_token: 'addon-token-hex', qr_payload: 'addon-payload' };
const TICKET = { id: 'ticket-1', event_id: EVENT_ID, qr_token: 'ticket-token-hex', qr_payload: 'ticket-payload' };

// Minimal PostgREST-shaped fake: filters rows by every .eq() applied.
function fakeDb() {
  const rpcCalls = [];
  const tables = {
    tickets: [TICKET],
    order_addons: [ADDON],
    events: [{ id: EVENT_ID, host_id: 'staff', perk_config: null }],
    event_co_organizers: [], users: [], ticket_types: [], membership_subscriptions: [],
  };
  return {
    rpcCalls,
    from(table) {
      const filters = [];
      const rows = () => (tables[table] || []).filter(r => filters.every(([k, v]) => String(r[k]) === String(v)));
      const q = {
        select: () => q, in: () => q, or: () => q,
        eq: (k, v) => { filters.push([k, v]); return q; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'no rows' } }),
        then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return q;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'redeem_addon') {
        const hit = args.p_qr_token === ADDON.qr_token && args.p_event_id === ADDON.event_id;
        return { data: hit
          ? { result: 'valid', orderAddonId: ADDON.id, addonName: 'VIP table', quantity: 1, status: 'redeemed', redeemedAt: 'now' }
          : { result: 'invalid' }, error: null };
      }
      if (name === 'redeem_ticket') {
        const hit = args.p_qr_token === TICKET.qr_token;
        return { data: hit
          ? { result: 'valid', ticketId: TICKET.id, eventId: EVENT_ID, ticketStatus: 'scanned' }
          : { result: 'invalid', ticketId: null }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

// Signature check stub: each known payload decodes to its minted (tid, eid).
const verifySignedQrPayload = async payload => ({
  'addon-payload': { valid: true, ticketId: 'random-uuid-not-a-ticket', eventId: EVENT_ID },
  'ticket-payload': { valid: true, ticketId: TICKET.id, eventId: EVENT_ID },
  'orphan-payload': { valid: true, ticketId: 'random-uuid-unknown', eventId: EVENT_ID },
}[payload] || { valid: false, reason: 'invalid_signature' });

function scan(body) {
  const db = fakeDb();
  const h = harness({ database: db, dependencyOverrides: { 'hmac-qr.ts': { verifySignedQrPayload } } });
  return h.invoke('ticket-scan', body).then(async r => ({ status: r.status, body: await r.json(), db }));
}

test('signed add-on qr_payload redeems the add-on through redeem_addon', async () => {
  const { status, body, db } = await scan({ qr_payload: 'addon-payload', event_id: EVENT_ID });
  assert.equal(status, 200);
  assert.equal(body.valid, true, JSON.stringify(body));
  assert.equal(body.kind, 'addon');
  assert.equal(body.addon.id, ADDON.id);
  assert.deepEqual(db.rpcCalls.map(c => c.name), ['redeem_addon']);
  assert.equal(db.rpcCalls[0].args.p_qr_token, ADDON.qr_token);
  assert.equal(db.rpcCalls[0].args.p_event_id, EVENT_ID);
});

test('signed ticket qr_payload still redeems the ticket', async () => {
  const { body, db } = await scan({ qr_payload: 'ticket-payload', event_id: EVENT_ID });
  assert.equal(body.valid, true, JSON.stringify(body));
  assert.deepEqual(db.rpcCalls.map(c => c.name), ['redeem_ticket']);
  assert.equal(db.rpcCalls[0].args.p_qr_token, TICKET.qr_token);
});

test('validly signed payload matching neither a ticket nor an add-on is not found', async () => {
  const { body, db } = await scan({ qr_payload: 'orphan-payload', event_id: EVENT_ID });
  assert.equal(body.valid, false);
  assert.equal(body.reason, 'ticket_not_found');
  assert.ok(!db.rpcCalls.some(c => c.name === 'redeem_addon'));
});

test('bad signature is rejected before any lookup', async () => {
  const { body, db } = await scan({ qr_payload: 'forged', event_id: EVENT_ID });
  assert.deepEqual(body, { valid: false, reason: 'invalid_signature' });
  assert.equal(db.rpcCalls.length, 0);
});
