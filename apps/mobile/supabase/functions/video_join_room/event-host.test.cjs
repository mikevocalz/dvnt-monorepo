const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const host = {};
vm.runInNewContext(transpile(path.join(__dirname, '../_shared/event-lynk-host.ts')), { exports: host, Error });

function fixture({ role = 'editor', accepted = true, standing = 'refused', userId = 'event-editor', hostReadFails = false, eventDenied = false } = {}) {
  const calls = [];
  let handler;
  const room = { id: 7, uuid: '00000000-0000-4000-8000-000000000007', created_by: 'event-owner', status: 'open', room_kind: 'lynk', is_public: false };
  const db = {
    rpc: async name => {
      calls.push(name);
      if (name === 'check_rate_limit') return { data: true };
      if (name === 'is_user_banned_from_room') return { data: false };
      if (name === 'lynk_admit_member_atomic') return { data: { ok: false, reason: 'room_full', current: 2, max: 2 } };
      return { data: null };
    },
    from: table => {
      const filters = [];
      const rows = table === 'video_rooms' ? [room] : table === 'event_co_organizers'
        ? [{ id: 11, event_id: 9, user_id: userId, role, accepted }] : [];
      const result = async () => ({ data: rows.find(row => filters.every(f => f(row))) ?? null,
        error: table === 'event_co_organizers' && hostReadFails ? { message: 'unavailable' } : null });
      const q = { select: () => q, limit: () => q,
        eq: (k, value) => { filters.push(row => row[k] === value); return q; },
        in: (k, values) => { filters.push(row => values.includes(row[k])); return q; },
        single: result, maybeSingle: result };
      return q;
    },
  };
  const chain = { uuid() { return this; }, optional() { return this; }, default() { return this; }, max() { return this; } };
  vm.runInNewContext(transpile(path.join(__dirname, 'index.ts')), {
    exports: {}, Date, Error, Response, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.includes('/zod@')) return { z: { string: () => chain, boolean: () => chain, object: () => ({ safeParse: data => ({ success: true, data }) }) } };
      if (name.includes('verify-session')) return { verifySessionDetailed: async () => ({ ok: true, userId }) };
      if (name.includes('verified-admission')) return { resolveVerifiedAdmission: async () => ({ state: 'allowed' }) };
      if (name.includes('event-access')) return { resolveEventRoomAccess: async () => eventDenied
        ? { ok: false, code: 'forbidden', message: 'Ticket required', detail: { reason: 'event_ticket_required' } }
        : { ok: true, linked: true, endsAt: null, event: { id: 9, host_id: 'event-owner', lynk_room_id: room.uuid } } };
      if (name.includes('event-lynk-host')) return host;
      if (name.includes('creator-standing')) return {
        resolveCreatorStanding: async () => { calls.push('standing'); return { state: standing }; },
        creatorStandingRefusal: () => ({ reason: 'suspended', message: 'Hosting suspended' }),
      };
      return {};
    },
  });
  return { calls, run: async () => (await handler(new Request('http://fixture', { method: 'POST',
    headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({ roomId: room.uuid }) }))).json() };
}

test('accepted event hosts cannot bypass creator suspension through a direct room link', async () => {
  for (const role of ['admin', 'editor']) {
    const h = fixture({ role });
    const result = await h.run();
    assert.equal(result.error.detail.reason, 'suspended');
    assert.equal(h.calls.includes('standing'), true);
    assert.equal(h.calls.includes('lynk_admit_member_atomic'), false, 'no seat or media token before standing approval');
  }
  const owner = fixture({ userId: 'event-owner' });
  assert.equal((await owner.run()).error.detail.reason, 'suspended');
});

test('event-host permission does not bypass capacity or promote a guest role', async () => {
  const h = fixture({ standing: 'allowed' });
  assert.equal((await h.run()).error.detail.reason, 'room_full');
  assert.ok(h.calls.indexOf('standing') < h.calls.indexOf('lynk_admit_member_atomic'));
  for (const opts of [{ role: 'scanner' }, { role: 'editor', accepted: false }]) {
    const guest = fixture(opts);
    assert.equal((await guest.run()).error.detail.reason, 'room_full');
    assert.equal(guest.calls.includes('standing'), false, 'event staff invite does not become a hosting role');
  }
});

test('unreadable event host permissions and lost ticket access fail before capacity or media', async () => {
  const unavailable = fixture({ hostReadFails: true });
  assert.equal((await unavailable.run()).error.code, 'internal_error');
  assert.equal(unavailable.calls.includes('lynk_admit_member_atomic'), false);
  const ticket = fixture({ eventDenied: true });
  assert.equal((await ticket.run()).error.detail.reason, 'event_ticket_required');
  assert.equal(ticket.calls.includes('standing'), false);
  assert.equal(ticket.calls.includes('lynk_admit_member_atomic'), false);
});
