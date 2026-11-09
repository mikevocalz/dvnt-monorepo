// Door scans of HMAC-signed QR payloads. Add-on payloads are minted in
// _shared/cart-issuance.ts (prepareCartAddonRows) with a random id in the
// `tid` slot, so the scan must fall back to order_addons.qr_payload when the
// id is not a ticket, then redeem through the redeem_addon CAS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

const EVENT_ID = 7;
const ADDON = { id: 'oa-1', event_id: EVENT_ID, qr_token: 'addon-token-hex', qr_payload: 'addon-payload' };
const TICKET = { id: 'ticket-1', event_id: EVENT_ID, ticket_type_id: 'tier-1', category: 'admission', qr_token: 'ticket-token-hex', qr_payload: 'ticket-payload' };

// Minimal PostgREST-shaped fake: filters rows by every .eq() applied.
function fakeDb(options = {}) {
  const rpcCalls = [];
  const tables = {
    tickets: [{ ...TICKET, ...(options.ticket || {}), ticket_types: options.missingCategory ? null : { name: options.category === "service" ? "Coat Check" : "Admission", category: options.category ?? "admission" } }],
    order_addons: [ADDON],
    events: [{ id: EVENT_ID, host_id: 'staff', status: options.eventStatus || 'published', perk_config: null }],
    event_co_organizers: [], users: [], ticket_types: [], effective_membership_tiers: [],
  };
  return {
    rpcCalls,
    from(table) {
      if (rpcCalls.length && options.failAfterCommit === table) throw new Error("private transport detail");
      const filters = [];
      const rows = () => (tables[table] || []).filter(r => filters.every(([k, v]) => String(r[k]) === String(v)));
      const q = {
        select: () => q, in: () => q, or: () => q,
        eq: (k, v) => { filters.push([k, v]); return q; },
        maybeSingle: async () => options.failLookup === table ? { data: null, error: { message: 'private database detail' } } : ({ data: rows()[0] ?? null, error: null }),
        single: async () => options.failLookup === table ? { data: null, error: { message: 'private database detail' } } : ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'no rows' } }),
        then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return q;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (options.rpcResult) return { data: options.rpcResult, error: null };
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

function scan(body, options) {
  const db = fakeDb(options);
  const h = harness({ database: db, dependencyOverrides: { 'hmac-qr.ts': { verifySignedQrPayload } } });
  return h.invoke('ticket-scan', { supports_credential_purposes: true, ...body }).then(async r => ({ status: r.status, body: await r.json(), db }));
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

for (const table of ['tickets', 'users', 'ticket_types']) {
  test(`committed scan remains successful when ${table} display lookup throws`, async () => {
    const { status, body, db } = await scan({ qr_payload: 'ticket-payload', event_id: EVENT_ID }, { failAfterCommit: table });
    assert.equal(status, 200);
    assert.equal(body.valid, true);
    assert.equal(body.ticket.id, TICKET.id);
    assert.equal(db.rpcCalls.length, 1);
    assert.ok(!JSON.stringify(body).includes('private transport detail'));
  });
}

for (const eventStatus of ['cancelled', 'deleted']) {
  for (const qr_payload of ['ticket-payload', 'addon-payload']) {
    test(`${eventStatus} event does not redeem ${qr_payload}`, async () => {
      const { status, body, db } = await scan({ qr_payload, event_id: EVENT_ID }, { eventStatus });
      assert.equal(status, 200);
      assert.deepEqual(body, { valid: false, reason: 'event_cancelled' });
      assert.equal(db.rpcCalls.length, 0);
    });
  }
}

for (const table of ['tickets', 'order_addons', 'events']) {
  test(`failed ${table} lookup is not an invalid-ticket verdict`, async () => {
    const { status, body, db } = await scan({ qr_payload: table === 'order_addons' ? 'addon-payload' : 'ticket-payload', event_id: EVENT_ID }, { failLookup: table });
    assert.equal(status, 500);
    assert.equal(body.valid, undefined);
    assert.equal(db.rpcCalls.length, 0);
    assert.ok(!JSON.stringify(body).includes('private database detail'));
  });
}
for (const qr_payload of ['ticket-payload', 'addon-payload']) {
  test(`event lifecycle race rejection remains non-admitting for ${qr_payload}`, async () => {
    const { status, body } = await scan({ qr_payload, event_id: EVENT_ID }, { rpcResult: { result: 'event_cancelled' } });
    assert.equal(status, 200);
    assert.equal(body.valid, false);
    assert.equal(body.reason, 'event_cancelled');
  });
  test(`event lock contention is retryable for ${qr_payload}`, async () => {
    const { status, body } = await scan({ qr_payload, event_id: EVENT_ID }, { rpcResult: { result: 'retry_later' } });
    assert.equal(status, 503);
    assert.equal(body.valid, undefined);
    assert.match(body.error, /retry/i);
  });
}

test('malformed explicit event context never silently falls back to the QR event', async () => {
  for (const event_id of ['7-other', 'invalid', 7.5, -7, true, {}, [], 2147483648]) {
    const { status, db } = await scan({ qr_payload: 'ticket-payload', event_id });
    assert.equal(status, 400, JSON.stringify(event_id));
    assert.equal(db.rpcCalls.length, 0);
  }
});
test('legacy event-less replay still resolves its authorized event', async () => {
  const { status, body } = await scan({ qr_payload: 'ticket-payload' });
  assert.equal(status, 200);
  assert.equal(body.valid, true);
});

for (const qr_payload of ['ticket-payload', 'addon-payload']) {
  test(`missing admission summary is retryable for ${qr_payload}`, async () => {
    const { status, body } = await scan({ qr_payload, event_id: EVENT_ID }, { rpcResult: { result: 'financials_unavailable' } });
    assert.equal(status, 503);
    assert.equal(body.valid, undefined);
  });
}

test('well-formed missing event is authoritative not-found, not database failure', async () => {
  const { status, body, db } = await scan({ qr_payload: 'ticket-payload', event_id: 999 });
  assert.equal(status, 404);
  assert.deepEqual(body, { valid: false, reason: 'event_not_found' });
  assert.equal(db.rpcCalls.length, 0);
});

for (const category of ['service', 'coat_check', 'product']) {
  test(`${category} QR redeems its own credential without announcing admission or perks`, async () => {
    for (const body of [{ qr_payload: 'ticket-payload', event_id: EVENT_ID }, { qr_token: TICKET.qr_token, event_id: EVENT_ID }]) {
      const r = await scan(body, { category });
      assert.equal(r.status, 200);
      assert.equal(r.body.valid, true);
      assert.equal(r.body.kind, category === 'product' ? 'product' : 'service');
      assert.equal(r.body.admits_entry, false);
      assert.equal(r.body.ticket.category, category);
      assert.deepEqual(r.body.perks, []);
      assert.equal(r.body.membership_tier, null);
      assert.deepEqual(r.db.rpcCalls.map(c => c.name), ['redeem_ticket']);
      assert.equal(r.db.rpcCalls[0].args.p_qr_token, TICKET.qr_token);
    }
  });
}
test('known admission remains entry, missing category evidence never does', async () => {
  const admitted = await scan({ qr_payload: 'ticket-payload', event_id: EVENT_ID });
  assert.equal(admitted.body.kind, 'ticket');
  assert.equal(admitted.body.admits_entry, true);
  const unknown = await scan({ qr_payload: 'ticket-payload', event_id: EVENT_ID }, { missingCategory: true });
  assert.equal(unknown.body.valid, true);
  assert.equal(unknown.body.kind, 'unknown');
  assert.equal(unknown.body.admits_entry, false);
});
test('service classification survives a failed post-redemption display read', async () => {
  const r = await scan({ qr_payload: 'ticket-payload', event_id: EVENT_ID }, { category: 'service', failAfterCommit: 'tickets' });
  assert.equal(r.body.valid, true);
  assert.equal(r.body.kind, 'service');
  assert.equal(r.body.admits_entry, false);
  assert.equal(r.body.ticket.tier_name, 'Coat Check');
});

test('untiered free RSVP remains admission while a broken tier reference fails closed', async () => {
 const r=await scan({qr_payload:'ticket-payload',event_id:EVENT_ID},{missingCategory:true,ticket:{ticket_type_id:null}});
 assert.equal(r.body.kind,'ticket');assert.equal(r.body.admits_entry,true);
});

for(const category of ['service','coat_check','product'])test(`older scanner cannot redeem ${category} as admission`,async()=>{
 const r=await scan({qr_payload:'ticket-payload',event_id:EVENT_ID,supports_credential_purposes:false},{category});
 assert.equal(r.status,426);assert.equal(r.body.code,'scanner_update_required');assert.equal(r.body.valid,undefined);assert.equal(r.db.rpcCalls.length,0);
});
test('older scanner admission QR remains supported without purpose capability',async()=>{
 const r=await scan({qr_payload:'ticket-payload',event_id:EVENT_ID,supports_credential_purposes:false});
 assert.equal(r.status,200);assert.equal(r.body.valid,true);assert.equal(r.body.admits_entry,true);
});
