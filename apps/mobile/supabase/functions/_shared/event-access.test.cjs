// canAccessEvent is the gate every checkout and RSVP function calls before it
// reserves inventory, issues a free ticket or talks to Stripe. These run the
// real module against an in-memory query fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load() {
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/event-access.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', 'require', source)(mod.exports, mod, require);
  return mod.exports;
}
const { canAccessEvent } = load();

function db(tables) {
  return {
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (k, v) => { filters.push((r) => r[k] === v); return q; },
        in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return q; },
        limit: () => q,
        maybeSingle: async () => ({ data: (tables[table] || []).find((r) => filters.every((f) => f(r))) || null, error: null }),
      };
      return q;
    },
  };
}

const FUTURE = new Date(Date.now() + 864e5).toISOString();
const PAST = new Date(Date.now() - 864e5).toISOString();
const event = (over) => ({ id: 7, host_id: 'host', visibility: 'public', status: 'active', is_hidden: false, publish_at: null, ...over });
const related = {
  event_co_organizers: [{ event_id: 7, user_id: 'coorg', accepted: true }],
  tickets: [{ event_id: 7, user_id: 'holder', status: 'active', category: 'admission' }],
  event_invites: [{ event_id: 7, invited_user_id: 'invitee', status: 'pending' }],
};
const can = (ev, user) => canAccessEvent(db({ events: [ev], ...related }), 7, user);

test('a published public event is open to anyone, signed in or not', async () => {
  assert.equal(await can(event(), 'stranger'), true);
  assert.equal(await can(event(), null), true);
  assert.equal(await can(event({ publish_at: PAST }), 'stranger'), true);
});

for (const [label, over] of [['hidden', { is_hidden: true }], ['not yet published', { publish_at: FUTURE }]]) {
  test(`a ${label} event refuses a stranger and a guest checkout`, async () => {
    assert.equal(await can(event(over), 'stranger'), false);
    assert.equal(await can(event(over), null), false);
  });

  test(`a ${label} event stays open to host, co-organizer, invitee and ticket holder`, async () => {
    for (const user of ['host', 'coorg', 'invitee', 'holder']) {
      assert.equal(await can(event(over), user), true, user);
    }
  });
}

test('an unparseable publish_at fails closed', async () => {
  assert.equal(await can(event({ publish_at: 'soon' }), 'stranger'), false);
});
