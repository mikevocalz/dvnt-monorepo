import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEventLynkRoom } from './prepare-event-lynk-room.ts';
function fixture() {
 let preparedLynkRoom: any = null; let creates = 0;
 const options = { authId: 'host', getState: () => ({ getPublishRequestId: () => 'draft', preparedLynkRoom }), save: (room: any) => { preparedLynkRoom = room; }, create: async () => { creates++; return { ok: true, data: { room: { id: 'room' } } }; } };
 return { options, count: () => creates };
}
test('publish retry reuses private room rather than orphaning replacements', async () => {
 const h = fixture(); assert.equal(await prepareEventLynkRoom(h.options), 'room');
 assert.equal(await prepareEventLynkRoom(h.options), 'room'); assert.equal(h.count(), 1);
});
test('double publish shares the pending room operation', async () => {
 const h = fixture(); await Promise.all([prepareEventLynkRoom(h.options), prepareEventLynkRoom(h.options)]); assert.equal(h.count(), 1);
});
test('room failure blocks publication and allows an explicit retry', async () => {
 const h = fixture(); await assert.rejects(prepareEventLynkRoom({ ...h.options, create: async () => ({ ok: false }) }), /not been published/);
 assert.equal(await prepareEventLynkRoom(h.options), 'room');
});
test('another signed-in account cannot reuse the previous host room', async () => {
 const h = fixture(); await prepareEventLynkRoom(h.options);
 await prepareEventLynkRoom({ ...h.options, authId: 'other' }); assert.equal(h.count(), 2);
});
test('signed-out creation is blocked before any room request', async () => {
 const h = fixture(); await assert.rejects(prepareEventLynkRoom({ ...h.options, authId: null }), /Sign in/); assert.equal(h.count(), 0);
});
test('a changed draft or account during creation cannot publish the stale room', async () => {
 for (const changed of ['draft', 'account']) {
  const h = fixture(); let requestId = 'draft'; let authId = 'host';
  await assert.rejects(prepareEventLynkRoom({ ...h.options,
   currentAuthId: () => authId,
   getState: () => ({ ...h.options.getState(), getPublishRequestId: () => requestId }),
   create: async () => { if (changed === 'draft') requestId = 'new'; else authId = 'other'; return { ok: true, data: { room: { id: 'old' } } }; },
  }), /draft changed/);
  assert.equal(h.options.getState().preparedLynkRoom, null);
 }
});
test('timeout is recoverable and retry waits for the original request, not a duplicate', async () => {
 const h = fixture(); let resolve!: (value: any) => void; let creates = 0;
 const options = { ...h.options, timeoutMs: 5, create: () => { creates++; return new Promise<any>(r => { resolve = r; }); } };
 await assert.rejects(prepareEventLynkRoom(options), /taking longer/);
 const retry = prepareEventLynkRoom({ ...options, timeoutMs: 1000 });
 resolve({ ok: true, data: { room: { id: 'slow-room' } } });
 assert.equal(await retry, 'slow-room'); assert.equal(creates, 1);
});
