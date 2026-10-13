// Execute the actual create handler with isolated fixtures. No room inserts,
// remote requests, Stripe traffic, or real sessions are permitted by this test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

function schema() {
  const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
  return { ...new Proxy({}, { get: () => () => chain }),
    string: () => chain, boolean: () => chain, number: () => chain,
    array: () => chain, enum: () => chain,
    object: () => ({ safeParse: data => ({ success: true, data }) }) };
}

for (const failed of [null, 'membership_subscriptions', 'sneaky_subscriptions']) {
  test(`create handler: ${failed || 'verified empty subscriptions'} before any room mutation`, async () => {
    const reads = [], calls = [];
    const db = {
      from(table) {
        assert.ok(['users', 'membership_subscriptions', 'sneaky_subscriptions'].includes(table), `Unexpected table/write: ${table}`);
        return { select() {
          const read = async (key, id) => {
            reads.push({ table, key, id });
            if (table === 'users') return { data: id === 'auth-fixture' ? [{ id: 123, auth_id: 'auth-fixture' }] : [], error: null };
            return { data: [], error: failed === table ? { message: 'fixture lookup failure' } : null };
          };
          return { eq: read, in: read };
        } };
      },
      async rpc(name) {
        assert.equal(name, 'check_rate_limit');
        calls.push(name);
        // Stop the verified path here, before writes. Subscription failure
        // must return before reaching even this rate-limit probe.
        return { data: false, error: null };
      },
    };
    const h = harness({ database: db, dependencyOverrides: {
      'mod.ts': { z: schema() },
      'verify-session.ts': { verifySessionDetailed: async () => ({ ok: true, userId: 'auth-fixture' }) },
      'creator-standing.ts': { resolveCreatorStanding: async () => ({ state: 'allowed' }) },
    } });
    const response = await h.invoke('video_create_room', {
      title: 'Fixture', roomKind: 'lynk', maxParticipants: 10, invitedUserIds: [],
    }, { Authorization: 'Bearer fixture-only' });
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, failed ? 'internal_error' : 'rate_limited');
    assert.equal(calls.length, failed ? 0 : 1);
    assert.equal(reads.length, 4);
    assert.deepEqual(Array.from(reads.find(r => r.table === 'membership_subscriptions').id), ['auth-fixture', '123']);
    assert.equal(reads.find(r => r.table === 'sneaky_subscriptions').id, 'auth-fixture');
    assert.equal(h.requests.length, 0);
    assert.equal(h.writes.length, 0);
  });
}
